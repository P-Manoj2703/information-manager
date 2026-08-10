import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RecordListDirective, RecordsPayloadMeta, RecordsResponseMeta } from '@escriba/cui-ecap-runtime';
import { Acknowledgement, AckStatus } from '@core/models';
import { SessionService } from '@core/services/session.service';
import { AcknowledgementService } from '@core/services/acknowledgement.service';
import { LanguageService } from '@core/i18n/language.service';
import { ACKNOWLEDGEMENT_VIEW_ID, OBJECT_ID } from '@core/objects';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { FilterChipsComponent, Chip } from '@shared/ui/filter-chips.component';
import { ColumnFilterComponent, ColumnFilterOption } from '@shared/ui/column-filter.component';

/**
 * UC-IP-06 / UC-CMP-03. Person-level chase across folders.
 *
 * Real data via libEcapRuntimeRecordList against Acknowledgement's own saved views — the
 * generic rest/record/{oid}?filter=... list endpoint proved unreliable for this object
 * (deterministic 0-row responses despite a correct totalRecordCount, at every page size
 * tried live), the same failure mode already worked around elsewhere in this app. ListDataPage
 * (what this directive calls) reliably returned real rows on every attempt instead.
 *
 * Each chip maps to one of ECAP's own real views rather than a client-side status filter, so
 * "My User Acknowledgments" is genuinely ECAP's "Acknowledgments Assigned to Users" view, and
 * "All" is the real "ALL ACKNOWLEDGEMENTS for CUI" view built specifically for this app
 * (confirmed via live network capture) — unlike the object's generic '0' view (used for the
 * same purpose on the folder list), which only returns id/record_locator and no real columns.
 * Row visibility on every chip is still enforced server-side by the object's own ACL, so
 * Compliance sees everything through "All" while other roles only see their own scoped subset.
 */
@Component({
  selector: 'im-chase-table',
  standalone: true,
  imports: [
    RouterLink, RecordListDirective, StatusBadgeComponent, FilterChipsComponent,
    ColumnFilterComponent
  ],
  styleUrl: './chase-table.component.scss',
  template: `
    @for (payload of payloads(); track $index) {
      <ng-container
        [libEcapRuntimeRecordList]="payload"
        (apiResponseEvent)="onAckResponse($index, $event)"
        (apiErrorEvent)="onAckError($index, $event)">
      </ng-container>
    }

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
          </tr></thead>
          <tbody>
            @for (a of rows(); track a.id) {
              <tr>
                <td>
                  <a class="person" [routerLink]="['/acknowledgements', a.id]">
                    <b>{{ a.acknowledgment_textfield_employee }}</b>
                  </a>
                </td>
                <td>{{ a.acknowledgement_textfield_information_folder_name }}</td>
                <td class="mono">{{ a.documentversion_record }}</td>
                <td class="tabular">{{ a.acknowledgement_date_deadline_date ? lang.date(a.acknowledgement_date_deadline_date) : '—' }}</td>
                <td>
                  <im-status-badge [status]="a.acknowledgment_picklist_status" />
                  @if (a.acknowledgment_picklist_status === 'Overdue') {
                    <small class="late">{{ acks.daysOverdue(a) }} {{ lang.isGerman() ? 'Tage' : 'days' }}</small>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="5" class="empty">{{ lang.isGerman() ? 'Keine Kenntnisnahmen in dieser Ansicht.' : 'No acknowledgements in this view.' }}</td></tr>
            }
          </tbody>
        </table>
      </div>
  `
})
export class ChaseTableComponent {
  readonly session = inject(SessionService);
  readonly acks = inject(AcknowledgementService);
  readonly lang = inject(LanguageService);

  /** Compliance's real ACL sees every record, so "All" is the more useful landing chip for them. */
  readonly filter = signal(this.session.role() === 'complianceverantwortlicher' ? 'all' : 'overdue');

  /** Which real ECAP view backs the current chip. */
  private readonly viewIds = computed<string[]>(() => {
    switch (this.filter()) {
      case 'overdue': return [ACKNOWLEDGEMENT_VIEW_ID.myOverdue];
      case 'pending': return [ACKNOWLEDGEMENT_VIEW_ID.myPending];
      case 'done': return [ACKNOWLEDGEMENT_VIEW_ID.myCompleted];
      case 'myUser': return [ACKNOWLEDGEMENT_VIEW_ID.assignedToUsers];
      case 'all': return [ACKNOWLEDGEMENT_VIEW_ID.allForCui];
      default: return [];
    }
  });

  readonly payloads = computed<RecordsPayloadMeta[]>(() =>
    this.viewIds().map((id) => ({
      id, object_id: OBJECT_ID.acknowledgement,
      page: 0, pageSize: 100, sortBy: 'date_modified', sortOrder: 'desc',
      getTotalRecordCount: false
    })));

  private readonly ackPartials = signal<Acknowledgement[][]>([]);
  private readonly all = computed(() => this.ackPartials().flat());

  constructor() {
    effect(() => {
      const count = this.payloads().length;
      this.ackPartials.set(Array.from({ length: count }, () => []));
    }, { allowSignalWrites: true });
  }

  onAckResponse(index: number, response: RecordsResponseMeta): void {
    const mapped = (response.listData?.recordsList ?? []).map((raw) => this.mapAck(raw));
    this.ackPartials.update((partials) => {
      const next = [...partials];
      next[index] = mapped;
      return next;
    });
  }

  onAckError(index: number, error: unknown): void {
    console.error('Failed to load Acknowledgement records', error);
    this.ackPartials.update((partials) => {
      const next = [...partials];
      next[index] = [];
      return next;
    });
  }

  /**
   * ListDataPage's real shape (confirmed live): picklists come back as plain strings, lookups
   * as {name, id} — not the generic REST endpoint's {displayValue, content} shape. Not every
   * view configures the same columns — email and the user id aren't part of the "My..." views,
   * but "ALL ACKNOWLEDGEMENTS for CUI" does expose email, so it's read when present rather than
   * guessed on views that don't have it.
   */
  private mapAck(raw: any): Acknowledgement {
    return {
      id: raw.id,
      acknowledgment_picklist_status: (raw.acknowledgment_picklist_status ?? 'None') as AckStatus,
      acknowledgment_textfield_employee: raw.acknowledgment_textfield_employee ?? '',
      acknowledgement_lookup_user: raw.owner_id?.id ?? '',
      acknowledgment_email_address_email: raw.acknowledgment_email_address_email ?? '',
      acknowledgement_lookup_information_folder: raw.acknowledgement_lookup_information_folder?.id ?? '',
      acknowledgement_textfield_information_folder_name:
        raw.acknowledgement_textfield_information_folder_name ?? raw.acknowledgement_lookup_information_folder?.name ?? '',
      documentversion_record: raw.documentversion_record?.name ?? raw.documentversion_record ?? '',
      acknowledgement_date_deadline_date: raw.acknowledgement_date_deadline_date ?? '',
      acknowledgment_richtextarea_user_information: ''
    };
  }

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
    const folder = this.folderFilter();
    const version = this.versionFilter();
    const deadline = this.deadlineFilter();
    const status = this.statusFilter();
    return this.all().filter((a) =>
      (!folder.length || folder.includes(a.acknowledgement_textfield_information_folder_name)) &&
      (!version.length || version.includes(a.documentversion_record)) &&
      (!deadline.length || deadline.includes(a.acknowledgement_date_deadline_date)) &&
      (!status.length || status.includes(a.acknowledgment_picklist_status)));
  });

  exportCsv(): void {
    const head = ['employee', 'folder', 'version', 'deadline', 'status'].join(';');
    const body = this.rows().map((a) => [
      a.acknowledgment_textfield_employee,
      a.acknowledgement_textfield_information_folder_name, a.documentversion_record,
      a.acknowledgement_date_deadline_date, a.acknowledgment_picklist_status
    ].join(';'));
    const url = URL.createObjectURL(new Blob([[head, ...body].join('\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'acknowledgements.csv'; link.click();
    URL.revokeObjectURL(url);
  }
}
