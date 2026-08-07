import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map } from 'rxjs';
import { AudienceMember, OrganizationalUnit, Team } from '../models';
import { DataPort } from './data.port';

@Injectable({ providedIn: 'root' })
export class AudienceService {
  private readonly data = inject(DataPort);

  /** Descendants of a team, used by the "Include Team Hierarchy" toggle. */
  descendants(teams: Team[], teamId: string): Team[] {
    const direct = teams.filter((t) => t.parent_team_id === teamId);
    return direct.flatMap((t) => [t, ...this.descendants(teams, t.id)]);
  }

  /** A team cannot be its own ancestor — guards drag-to-reparent. */
  wouldCreateCycle(teams: Team[], teamId: string, newParentId: string): boolean {
    let cursor: string | null = newParentId;
    while (cursor) {
      if (cursor === teamId) return true;
      cursor = teams.find((t) => t.id === cursor)?.parent_team_id ?? null;
    }
    return false;
  }

  /**
   * Live "resolves to N people" count. Deduplicates: a person reached both
   * directly and via a team is counted once, keeping the strongest provenance.
   */
  resolve(folderId: string, directUserIds: string[]): Observable<AudienceMember[]> {
    return combineLatest([this.data.users(), this.data.teams(), this.data.orgUnits(folderId)]).pipe(
      map(([users, teams, units]) => {
        const byUser = new Map<string, AudienceMember>();
        const rank = { direct: 3, team: 2, hierarchy: 1 } as const;

        const add = (userId: string, provenance: AudienceMember['provenance'], viaTeamId?: string) => {
          const user = users.find((u) => u.id === userId);
          if (!user || !user.active) return;
          const existing = byUser.get(userId);
          if (existing && rank[existing.provenance] >= rank[provenance]) return;
          byUser.set(userId, { user, provenance, viaTeamId });
        };

        directUserIds.forEach((id) => add(id, 'direct'));

        units.forEach((unit: OrganizationalUnit) => {
          users.filter((u) => u.primaryTeamId === unit.teamId).forEach((u) => add(u.id, 'team', unit.teamId));
          if (unit.includeTeamHierarchy) {
            this.descendants(teams, unit.teamId).forEach((child) =>
              users.filter((u) => u.primaryTeamId === child.id).forEach((u) => add(u.id, 'hierarchy', child.id)));
          }
        });

        return [...byUser.values()];
      })
    );
  }
}
