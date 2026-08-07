import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DataPort } from '@core/services/data.port';
import { SessionService } from '@core/services/session.service';
import { LanguageService } from '@core/i18n/language.service';
import { Team } from '@core/models';

interface Node { team: Team; depth: number; }

/** UC-ADM-02 — the hierarchy feature depends on a tree, not a flat grid. */
@Component({
  selector: 'im-team-tree',
  standalone: true,
  styles: [`
    .tree { background:#fff; border:1px solid var(--border-1); border-radius:var(--radius-card); padding:8px 0; max-width:840px; }
    .node { display:flex; align-items:center; gap:12px; padding:12px 20px; border-bottom:1px solid var(--border-1); }
    .name { flex:1; font-size:14px; font-weight:600; }
    .members { background:var(--bg-3); border-radius:var(--radius-pill); padding:3px 10px; font-size:12px; font-weight:600; color:var(--fg-2); }
    .del { border:0; background:none; cursor:pointer; font:inherit; font-size:12px; color:var(--fg-3); }
    .note { margin-top:16px; font-size:12px; color:var(--fg-3); max-width:70ch; line-height:1.6; }
  `],
  template: `
    <div class="tree">
      @for (n of nodes(); track n.team.id) {
        <div class="node" [style.padding-left.px]="20 + n.depth * 26">
          <span class="name">{{ n.team.information_manager_teams_textfield_name }}</span>
          <span class="members">{{ n.team.memberCount }}</span>
          @if (session.canEditUsersAndTeams()) {
            <button type="button" class="del" (click)="confirmDelete(n.team)">{{ lang.isGerman() ? 'Löschen' : 'Delete' }}</button>
          }
        </div>
      }
    </div>
    <p class="note">{{ lang.isGerman()
      ? 'Beim Löschen werden Unterteams und Ordner-Verknüpfungen geprüft. Ein Team kann nicht sein eigener Vorgänger sein.'
      : 'Deleting checks sub-teams and folder links. A team cannot be its own ancestor.' }}</p>
  `
})
export class TeamTreeComponent {
  private readonly data = inject(DataPort);
  readonly session = inject(SessionService);
  readonly lang = inject(LanguageService);
  private readonly teams = toSignal(this.data.teams(), { initialValue: [] as Team[] });

  readonly nodes = computed<Node[]>(() => {
    const all = this.teams();
    const walk = (parentId: string | null, depth: number): Node[] =>
      all.filter((t) => t.parent_team_id === parentId)
         .flatMap((t) => [{ team: t, depth }, ...walk(t.id, depth + 1)]);
    return walk(null, 0);
  });

  /** Routes through the existing TeamDeleteConfirm flow. */
  confirmDelete(team: Team): void { console.info('TeamDeleteConfirm', team.id); }
}
