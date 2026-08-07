import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Acknowledgement, AckStatus } from '@core/models';
import { DataPort } from '@core/services/data.port';
import { SessionService } from '@core/services/session.service';
import { AcknowledgementService } from '@core/services/acknowledgement.service';
import { LanguageService } from '@core/i18n/language.service';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { FilterChipsComponent, Chip } from '@shared/ui/filter-chips.component';
import { ColumnFilterComponent, ColumnFilterOption } from '@shared/ui/column-filter.component';
import { OverrideDialogComponent } from './override-dialog.component';

/** UC-IP-06 / UC-CMP-03. Person-level chase across folders. */
@Component({
  selector: 'im-chase-table',
  standalone: true,
  imports: [RouterLink, StatusBadgeComponent, FilterChipsComponent, ColumnFilterComponent, OverrideDialogComponent],
  styleUrl: './chase-table.component.scss',
  template: `
    <div class="bar">
      <im-filter-chips [chips]="chips()" [(value)]="filter" />
      <span class="spacer"></span>
      <button type="button" class="ghost" (click)="exportCsv()">{{ lang.isGerman() ? 'CSV exportieren' : 'Export CSV' }}</button>
    </div>

    <div class="scroll">
      <table>
        <thead><tr>
          <th>{{ lang.isGerman() ? 'Person' : 'Person' }}</th>
          <th>
            <im-column-filter [title]="lang.t('folders')" [options]="folderOptions()" [(selected)]="folderFilter">
              {{ lang.t('folders') }}
            </im-column-filter>
          </th>
          <th>
            <im-column-filter [title]="lang.t('version')" [options]="versionOptions()" [(selected)]="versionFilter">
              {{ lang.t('version') }}
            </im-column-filter>
          </th>
          <th>
            <im-column-filter [title]="lang.t('deadline')" [options]="deadlineOptions()" [(selected)]="deadlineFilter">
              {{ lang.t('deadline') }}
            </im-column-filter>
          </th>
          <th>
            <im-column-filter [title]="lang.t('status')" [options]="statusOptions()" [(selected)]="statusFilter">
              {{ lang.t('status') }}
            </im-column-filter>
          </th>
          <th></th>
        </tr></thead>
        <tbody>
          @for (a of rows(); track a.id) {
            <tr>
              <td>
                <a class="person" [routerLink]="['/acknowledgements', a.id]">
                  <b>{{ a.acknowledgment_textfield_employee }}</b>
                  <small>{{ a.acknowledgment_email_address_email }}</small>
                </a>
              </td>
              <td>{{ a.acknowledgement_textfield_information_folder_name }}</td>
              <td class="mono">{{ a.documentversion_record }}</td>
              <td class="tabular">{{ lang.date(a.acknowledgement_date_deadline_date) }}</td>
              <td>
                <im-status-badge [status]="a.acknowledgment_picklist_status" />
                @if (a.acknowledgment_picklist_status === 'Overdue') {
                  <small class="late">{{ acks.daysOverdue(a) }} {{ lang.isGerman() ? 'Tage' : 'days' }}</small>
                }
              </td>
              <td class="actions">
                @if (session.canOverrideAck()) {
                  <button type="button" class="ghost" (click)="remind(a)">{{ lang.t('remindNow') }}</button>
                  <button type="button" class="ghost" (click)="target.set(a)">{{ lang.t('override') }}</button>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>

    @if (!session.canOverrideAck()) {
      <p class="readonly">{{ lang.isGerman()
        ? 'Sie haben Lesezugriff auf diese Kenntnisnahmen. Statusänderungen sind Compliance vorbehalten.'
        : 'You have read access to these acknowledgements. Status changes are reserved for Compliance.' }}</p>
    }

    @if (target(); as t) { <im-override-dialog [ack]="t" (closed)="target.set(null)" /> }
  `
})
export class ChaseTableComponent {
  private readonly data = inject(DataPort);
  readonly session = inject(SessionService);
  readonly acks = inject(AcknowledgementService);
  readonly lang = inject(LanguageService);

  readonly filter = signal('overdue');
  readonly target = signal<Acknowledgement | null>(null);
  private readonly all = toSignal(this.data.acknowledgements({}), { initialValue: [] as Acknowledgement[] });

  /** Column-header filters, empty array = no filter for that column. */
  readonly folderFilter = signal<string[]>([]);
  readonly versionFilter = signal<string[]>([]);
  readonly deadlineFilter = signal<string[]>([]);
  readonly statusFilter = signal<string[]>([]);

  private readonly STATUS_LABEL: Record<AckStatus, [string, string]> = {
    None: ['Keine', 'None'], Pending: ['Offen', 'Pending'], Overdue: ['Überfällig', 'Overdue'],
    Done: ['Erledigt', 'Done'], Obsolete: ['Nicht mehr erforderlich', 'Obsolete']
  };

  readonly folderOptions = computed<ColumnFilterOption[]>(() =>
    [...new Set(this.all().map((a) => a.acknowledgement_textfield_information_folder_name))]
      .sort()
      .map((name) => ({ value: name, label: name })));

  readonly versionOptions = computed<ColumnFilterOption[]>(() =>
    [...new Set(this.all().map((a) => a.documentversion_record))]
      .sort()
      .map((v) => ({ value: v, label: v })));

  readonly deadlineOptions = computed<ColumnFilterOption[]>(() =>
    [...new Set(this.all().map((a) => a.acknowledgement_date_deadline_date))]
      .sort()
      .map((d) => ({ value: d, label: this.lang.date(d) })));

  readonly statusOptions = computed<ColumnFilterOption[]>(() =>
    (['None', 'Pending', 'Overdue', 'Done', 'Obsolete'] as AckStatus[])
      .map((s) => ({ value: s, label: this.STATUS_LABEL[s][this.lang.isGerman() ? 0 : 1] })));

  readonly chips = computed<Chip[]>(() => [
    { id: 'overdue', label: this.lang.t('overdue') },
    { id: 'pending', label: this.lang.t('pending') },
    { id: 'done', label: this.lang.t('done') },
    { id: 'all', label: this.lang.isGerman() ? 'Alle' : 'All' },
    { id: 'myUser', label: this.lang.isGerman() ? 'Meine Benutzer-Kenntnisnahmen' : 'My User Acknowledgments' }
  ]);

  readonly rows = computed(() => {
    const f = this.filter();
    const myUserId = this.session.session().userId;
    const byChip = this.all().filter((a) => {
      const s = a.acknowledgment_picklist_status;
      if (f === 'overdue') return s === 'Overdue';
      if (f === 'pending') return s === 'Pending';
      if (f === 'done') return s === 'Done';
      if (f === 'myUser') return a.acknowledgement_lookup_user === myUserId;
      return true;
    });

    const folder = this.folderFilter();
    const version = this.versionFilter();
    const deadline = this.deadlineFilter();
    const status = this.statusFilter();
    return byChip.filter((a) =>
      (!folder.length || folder.includes(a.acknowledgement_textfield_information_folder_name)) &&
      (!version.length || version.includes(a.documentversion_record)) &&
      (!deadline.length || deadline.includes(a.acknowledgement_date_deadline_date)) &&
      (!status.length || status.includes(a.acknowledgment_picklist_status)));
  });

  /** New requirement — the tenant only has nightly automatic emails. */
  remind(a: Acknowledgement): void { this.data.remind([a.id]).subscribe(); }

  exportCsv(): void {
    const head = ['employee', 'email', 'folder', 'version', 'deadline', 'status'].join(';');
    const body = this.rows().map((a) => [
      a.acknowledgment_textfield_employee, a.acknowledgment_email_address_email,
      a.acknowledgement_textfield_information_folder_name, a.documentversion_record,
      a.acknowledgement_date_deadline_date, a.acknowledgment_picklist_status
    ].join(';'));
    const url = URL.createObjectURL(new Blob([[head, ...body].join('\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'acknowledgements.csv'; link.click();
    URL.revokeObjectURL(url);
  }
}
