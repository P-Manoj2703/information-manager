import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { AckStatus, Confidentiality, FolderStatus, InformationFolder } from '@core/models';
import { DataPort } from '@core/services/data.port';
import { SessionService } from '@core/services/session.service';
import { LanguageService } from '@core/i18n/language.service';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { FilterChipsComponent, Chip } from '@shared/ui/filter-chips.component';
import { EmptyStateComponent } from '@shared/ui/empty-state.component';
import { ColumnFilterComponent, ColumnFilterOption } from '@shared/ui/column-filter.component';

/** Saved views from the tenant: My / My Teams × Active / Draft / Inactive. */
@Component({
  selector: 'im-folder-list',
  standalone: true,
  imports: [RouterLink, StatusBadgeComponent, FilterChipsComponent, EmptyStateComponent, ColumnFilterComponent],
  styles: [`
    .bar { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
    .bar .spacer { margin-left: auto; }
    .new { background: var(--escriba-teal); color: var(--navy-900); padding: 11px 20px;
           border-radius: var(--radius-pill); font-weight: 600; }
    table { width: 100%; border-collapse: collapse; background: #fff;
            border: 1px solid var(--border-1); border-radius: var(--radius-card); overflow: hidden; }
    th { text-align: left; font-size: 11px; font-weight: 700; letter-spacing: .08em; color: var(--fg-3);
         background: var(--bg-2); padding: 12px 20px; white-space: nowrap; position: relative; }
    td { padding: 18px 20px; border-top: 1px solid var(--border-1); font-size: 14px; vertical-align: top; }
    .name { font-weight: 600; } .sub { font-size: 12px; color: var(--fg-3); margin-top: 4px; }
    .actions { text-align: right; }
    .deactivate { border:1px solid var(--border-2); background:#fff; color:var(--fg-2); cursor:pointer;
                  font:inherit; font-size:12px; font-weight:600; padding:7px 14px; border-radius:var(--radius-pill);
                  &:disabled { opacity:.5; cursor:not-allowed; } }
    .activate { border:0; background:var(--escriba-teal); color:var(--navy-900); cursor:pointer;
                font:inherit; font-size:12px; font-weight:600; padding:7px 14px; border-radius:var(--radius-pill);
                &:disabled { opacity:.5; cursor:not-allowed; } }
  `],
  template: `
    <div class="bar">
      <im-filter-chips [chips]="chips()" [(value)]="view" />
      <span class="spacer"></span>
      @if (session.canCreateFolder()) {
        <a class="new" routerLink="/folders/new">{{ lang.isGerman() ? 'Neuer Informationsordner' : 'New information folder' }}</a>
      }
    </div>

    <table>
      <thead><tr>
        <th>{{ lang.t('folders') }}</th>
        <th>
          <im-column-filter [title]="lang.isGerman() ? 'Vertraulichkeit' : 'Confidentiality'"
                             [options]="confidentialityOptions" [(selected)]="confidentialityFilter">
            {{ lang.isGerman() ? 'Vertraulichkeit' : 'Confidentiality' }}
          </im-column-filter>
        </th>
        <th>
          <im-column-filter [title]="lang.t('status')" [options]="statusOptions()" [(selected)]="statusFilter">
            {{ lang.t('status') }}
          </im-column-filter>
        </th>
        <th>
          <im-column-filter [title]="lang.isGerman() ? 'Kenntnisnahme-Status' : 'Roll-up'"
                             [options]="rollupOptions()" [(selected)]="rollupFilter">
            {{ lang.isGerman() ? 'Kenntnisnahme-Status' : 'Roll-up' }}
          </im-column-filter>
        </th>
        <th>
          <im-column-filter [title]="lang.t('deadline')" [options]="deadlineOptions()" [(selected)]="deadlineFilter">
            {{ lang.t('deadline') }}
          </im-column-filter>
        </th>
        <th></th>
      </tr></thead>
      <tbody>
        @for (f of visible(); track f.id) {
          <tr>
            <td>
              <a class="name" [routerLink]="['/folders', f.id]">{{ f.information_folder_textfield_name }}</a>
              <div class="sub">{{ f.information_folder_textfield_short_name }}</div>
            </td>
            <td>{{ f.information_folder_picklist_confidentiality_level }}</td>
            <td><im-status-badge [status]="f.information_folder_picklist_status" /></td>
            <td><im-status-badge [status]="f.information_folder_picklist_acknowledgment_status" /></td>
            <td>{{ f.information_folder_number_deadlinedays }} {{ lang.isGerman() ? 'Tage' : 'days' }}</td>
            <td class="actions">
              @if (session.canCreateFolder()) {
                @if (f.information_folder_picklist_status === 'Active') {
                  <button type="button" class="deactivate" [disabled]="busy() === f.id" (click)="deactivate(f.id)">
                    {{ lang.isGerman() ? 'Deaktivieren' : 'Deactivate' }}
                  </button>
                } @else if (f.information_folder_picklist_status === 'Draft' || f.information_folder_picklist_status === 'Inactive') {
                  <button type="button" class="activate" [disabled]="busy() === f.id" (click)="activate(f.id)">
                    {{ lang.isGerman() ? 'Aktivieren' : 'Activate' }}
                  </button>
                }
              }
            </td>
          </tr>
        }
      </tbody>
    </table>

    @if (!visible().length) {
      <im-empty-state [title]="lang.isGerman() ? 'Keine Informationsordner in dieser Ansicht' : 'No information folders in this view'"
                      [body]="lang.isGerman() ? 'Wechseln Sie die Ansicht oder legen Sie einen neuen Ordner an.' : 'Switch the view or create a new folder.'" />
    }
  `
})
export class FolderListComponent {
  private readonly data = inject(DataPort);
  readonly session = inject(SessionService);
  readonly lang = inject(LanguageService);
  readonly view = signal('myActive');
  readonly busy = signal<string | null>(null);

  /** Empty array = no filter applied for that column. */
  readonly confidentialityFilter = signal<string[]>([]);
  readonly statusFilter = signal<string[]>([]);
  readonly rollupFilter = signal<string[]>([]);
  readonly deadlineFilter = signal<string[]>([]);

  readonly confidentialityOptions: ColumnFilterOption[] =
    (['Internal', 'Public', 'Confidential'] as Confidentiality[]).map((c) => ({ value: c, label: c }));

  private readonly STATUS_LABEL: Record<FolderStatus, [string, string]> = {
    Draft: ['Entwurf', 'Draft'], Active: ['Aktiv', 'Active'], Inactive: ['Inaktiv', 'Inactive']
  };
  private readonly ROLLUP_LABEL: Record<AckStatus, [string, string]> = {
    None: ['Keine', 'None'], Pending: ['Offen', 'Pending'], Overdue: ['Überfällig', 'Overdue'],
    Done: ['Erledigt', 'Done'], Obsolete: ['Nicht mehr erforderlich', 'Obsolete']
  };

  /** computed(), not a plain field — the labels must re-translate when the DE/EN toggle flips. */
  readonly statusOptions = computed<ColumnFilterOption[]>(() =>
    (['Draft', 'Active', 'Inactive'] as FolderStatus[])
      .map((s) => ({ value: s, label: this.STATUS_LABEL[s][this.lang.isGerman() ? 0 : 1] })));
  readonly rollupOptions = computed<ColumnFilterOption[]>(() =>
    (['None', 'Pending', 'Overdue', 'Done', 'Obsolete'] as AckStatus[])
      .map((r) => ({ value: r, label: this.ROLLUP_LABEL[r][this.lang.isGerman() ? 0 : 1] })));

  private readonly refresh = signal(0);
  private readonly all = toSignal(
    toObservable(this.refresh).pipe(switchMap(() => this.data.folders())),
    { initialValue: [] as InformationFolder[] });

  readonly deadlineOptions = computed<ColumnFilterOption[]>(() =>
    [...new Set(this.all().map((f) => f.information_folder_number_deadlinedays))]
      .sort((a, b) => a - b)
      .map((d) => ({ value: String(d), label: `${d} ${this.lang.isGerman() ? 'Tage' : 'days'}` })));

  readonly chips = computed<Chip[]>(() => [
    { id: 'myActive', label: this.lang.isGerman() ? 'Meine aktiven' : 'My active' },
    { id: 'myDraft', label: this.lang.isGerman() ? 'Meine Entwürfe' : 'My drafts' },
    { id: 'teamActive', label: this.lang.isGerman() ? 'Team — aktiv' : 'Team — active' },
    { id: 'inactive', label: this.lang.t('inactive') },
    { id: 'all', label: this.lang.isGerman() ? 'Alle' : 'All' }
  ]);

  /** Row security: creator OR matching hidden Primary Team Id. */
  readonly visible = computed(() => {
    const me = this.session.session();
    const mine = (f: InformationFolder) => f.created_id === me.userId;
    const team = (f: InformationFolder) => f.information_folder_text_field_primary_team_id === me.primaryTeamId;
    const byView = this.all().filter((f) => {
      const status = f.information_folder_picklist_status;
      switch (this.view()) {
        case 'myActive': return mine(f) && status === 'Active';
        case 'myDraft': return mine(f) && status === 'Draft';
        case 'teamActive': return (mine(f) || team(f)) && status === 'Active';
        case 'inactive': return status === 'Inactive';
        default: return mine(f) || team(f) || this.session.role() !== 'informationsbereitsteller';
      }
    });

    const conf = this.confidentialityFilter();
    const status = this.statusFilter();
    const rollup = this.rollupFilter();
    const deadline = this.deadlineFilter();
    return byView.filter((f) =>
      (!conf.length || conf.includes(f.information_folder_picklist_confidentiality_level)) &&
      (!status.length || status.includes(f.information_folder_picklist_status)) &&
      (!rollup.length || rollup.includes(f.information_folder_picklist_acknowledgment_status)) &&
      (!deadline.length || deadline.includes(String(f.information_folder_number_deadlinedays))));
  });

  deactivate(folderId: string): void {
    this.busy.set(folderId);
    this.data.deactivateFolder(folderId).subscribe(() => {
      this.busy.set(null);
      this.refresh.update((n) => n + 1);
    });
  }

  activate(folderId: string): void {
    this.busy.set(folderId);
    this.data.activateFolder(folderId).subscribe(() => {
      this.busy.set(null);
      this.refresh.update((n) => n + 1);
    });
  }
}
