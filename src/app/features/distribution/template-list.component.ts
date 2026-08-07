import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DataPort } from '@core/services/data.port';
import { AudienceService } from '@core/services/audience.service';
import { LanguageService } from '@core/i18n/language.service';
import { AppUser, DistributionTemplate, Team } from '@core/models';

@Component({
  selector: 'im-template-list',
  standalone: true,
  imports: [RouterLink],
  styles: [`
    .bar { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
    .intro { font-size:13px; color:var(--fg-2); max-width:70ch; line-height:1.6; margin:0; }
    .spacer { flex: 1; }
    .new { background: var(--escriba-teal); color: var(--navy-900); padding: 11px 20px;
           border-radius: var(--radius-pill); font-weight: 600; white-space: nowrap; }
    table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--border-1);
            border-radius:var(--radius-card); overflow:hidden; }
    th { text-align:left; font-size:11px; font-weight:700; letter-spacing:.08em; color:var(--fg-3);
         background:var(--bg-2); padding:12px 20px; }
    td { padding:16px 20px; border-top:1px solid var(--border-1); font-size:14px; }
  `],
  template: `
    <div class="bar">
      <p class="intro">
        {{ lang.isGerman()
          ? 'Eine Verteilervorlage bündelt Teams und Personen zu einer wiederverwendbaren Zielgruppe. Beim Anwenden werden die Mitglieder einmalig kopiert.'
          : 'A distribution template bundles teams and people into a reusable audience. Applying it copies the members once.' }}
      </p>
      <span class="spacer"></span>
      <a class="new" routerLink="/templates/new">
        {{ lang.isGerman() ? 'Neue Verteilervorlage' : 'New distribution template' }}
      </a>
    </div>
    <table>
      <thead><tr><th>{{ lang.t('templates') }}</th><th>{{ lang.t('resolvesTo') }}</th></tr></thead>
      <tbody>
        @for (t of templates(); track t.id) {
          <tr>
            <td><a [routerLink]="['/templates', t.id]">{{ t.name }}</a></td>
            <td>{{ resolvedCount(t) }} {{ lang.t('people') }}</td>
          </tr>
        }
      </tbody>
    </table>
  `
})
export class TemplateListComponent {
  private readonly data = inject(DataPort);
  private readonly audience = inject(AudienceService);
  readonly lang = inject(LanguageService);

  readonly templates = toSignal(this.data.templates(), { initialValue: [] as DistributionTemplate[] });
  private readonly teams = toSignal(this.data.teams(), { initialValue: [] as Team[] });
  private readonly users = toSignal(this.data.users(), { initialValue: [] as AppUser[] });

  /**
   * Real resolved count — direct users plus everyone pulled in through linked teams
   * (and their sub-teams when hierarchy is on), deduplicated. `userIds.length` alone
   * ignored team membership entirely, so team-only templates always showed "0 people".
   */
  resolvedCount(t: DistributionTemplate): number {
    const users = this.users();
    const teams = this.teams();
    const seen = new Set<string>();

    t.userIds.forEach((id) => { if (users.find((u) => u.id === id)?.active) seen.add(id); });
    t.teams.forEach((link) => {
      users.filter((u) => u.active && u.primaryTeamId === link.teamId).forEach((u) => seen.add(u.id));
      if (link.includeTeamHierarchy) {
        this.audience.descendants(teams, link.teamId).forEach((child) =>
          users.filter((u) => u.active && u.primaryTeamId === child.id).forEach((u) => seen.add(u.id)));
      }
    });
    return seen.size;
  }
}
