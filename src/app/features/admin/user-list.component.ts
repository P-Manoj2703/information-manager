import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DataPort } from '@core/services/data.port';
import { SessionService } from '@core/services/session.service';
import { LanguageService } from '@core/i18n/language.service';
import { AppUser } from '@core/models';
import { FilterChipsComponent, Chip } from '@shared/ui/filter-chips.component';

/** UC-ADM-01. For the Information Provider every create/edit control is HIDDEN. */
@Component({
  selector: 'im-user-list',
  standalone: true,
  imports: [FilterChipsComponent],
  styles: [`
    .bar { display:flex; align-items:center; gap:12px; margin-bottom:16px; .spacer { margin-left:auto; } }
    table { width:100%; max-width:980px; border-collapse:collapse; background:#fff;
            border:1px solid var(--border-1); border-radius:var(--radius-card); overflow:hidden; }
    th { text-align:left; font-size:11px; font-weight:700; letter-spacing:.08em; color:var(--fg-3);
         background:var(--bg-2); padding:12px 20px; }
    td { padding:14px 20px; border-top:1px solid var(--border-1); font-size:13px; }
    .note { margin-top:12px; font-size:12px; color:var(--fg-3); }
    .primary { border:0; cursor:pointer; font:inherit; font-weight:600; background:var(--escriba-teal);
               color:var(--navy-900); padding:9px 18px; border-radius:var(--radius-pill); }
  `],
  template: `
    <div class="bar">
      <im-filter-chips [chips]="chips()" [(value)]="filter" />
      <span class="spacer"></span>
      @if (session.canEditUsersAndTeams()) {
        <button type="button" class="primary">{{ lang.isGerman() ? 'Neuer Benutzer' : 'New user' }}</button>
      }
    </div>
    <table>
      <thead><tr><th>Name</th><th>E-Mail</th><th>{{ lang.t('status') }}</th></tr></thead>
      <tbody>
        @for (u of rows(); track u.id) {
          <tr><td>{{ u.firstName }} {{ u.lastName }}</td><td>{{ u.email }}</td>
              <td>{{ u.active ? lang.t('active') : lang.t('inactive') }}</td></tr>
        }
      </tbody>
    </table>
    <p class="note">{{ lang.isGerman()
      ? 'Löschen ist dem Systemadministrator vorbehalten — die Aktion wird hier nicht angezeigt.'
      : 'Deletion is reserved for the system administrator — the action is not rendered here.' }}</p>
  `
})
export class UserListComponent {
  private readonly data = inject(DataPort);
  readonly session = inject(SessionService);
  readonly lang = inject(LanguageService);
  readonly filter = signal('active');
  private readonly all = toSignal(this.data.users(), { initialValue: [] as AppUser[] });

  readonly chips = computed<Chip[]>(() => [
    { id: 'active', label: this.lang.t('active') },
    { id: 'inactive', label: this.lang.t('inactive') },
    { id: 'all', label: this.lang.isGerman() ? 'Alle' : 'All' }
  ]);
  readonly rows = computed(() => this.all().filter((u) =>
    this.filter() === 'all' ? true : this.filter() === 'active' ? u.active : !u.active));
}
