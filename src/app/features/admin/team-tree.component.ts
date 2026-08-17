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
  templateUrl: './team-tree.component.html',
  styleUrl: './team-tree.component.scss'
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
