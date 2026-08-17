import { Component, computed, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { RecordListDirective, RecordsPayloadMeta, RecordsResponseMeta } from '@escriba/cui-ecap-runtime';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { AckStatus } from '@core/models';
import { LanguageService } from '@core/i18n/language.service';
import { ACKNOWLEDGEMENT_VIEW_ID, OBJECT_ID } from '@core/objects';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { PagerComponent } from '@shared/ui/pager.component';
import { ColumnFilterComponent, ColumnFilterOption } from '@shared/ui/column-filter.component';

/**
 * documentversion_record's name/displayValue is the full record_locator ("{folder name} -
 * {version}") — only the part after the last " - " is the version itself, same parsing already
 * proven for this shape elsewhere (ack-detail.component.ts, task-list.component.ts, etc.).
 */
function versionLabelOf(displayValue: string | undefined): string {
  return (displayValue ?? '').split(' - ').pop() || '';
}

interface MonitorRow {
  id: string;
  caseNumber: string;
  employee: string;
  email: string;
  /** Greeting name for the reminder email — the record's owner_id.name, not the employee text field. */
  ownerName: string;
  documentVersionLabel: string;
  /** documentversion_record's own real value (the full record_locator) — needed to filter server-side, since ECAP has no separate short-version field to filter on. */
  documentVersionRaw: string;
  acknowledgment_picklist_status: AckStatus;
  /** MM/DD/YYYY, as ListDataPage and the record-update endpoint both use for this object. */
  deadline: string;
  folderName: string;
}

const STATUS_OPTIONS: AckStatus[] = ['Pending', 'Overdue', 'Done', 'Obsolete', 'None'];

/**
 * Real ECAP field names for server-side filtering, confirmed live via network capture
 * (2026-08-14) against ListDataPage's own `filter` query param:
 *   (field equals 'v1' OR field equals 'v2') AND (field2 equals 'v3')
 * — one parenthesized OR-group per column with values selected, groups joined by AND.
 * Employee/folder use the plain text mirror fields (same confidence as the picklist fields
 * below, and the same pattern already proven elsewhere in this codebase for exact-match
 * filters). documentversion_record is the one genuinely unverified case here — it's an
 * object/lookup field, not text or picklist, so equals-matching its display value is a
 * best-effort extension of the confirmed pattern, not a tested one.
 */
const FILTER_FIELD = {
  employee: 'acknowledgment_textfield_employee',
  folder: 'acknowledgement_textfield_information_folder_name',
  version: 'documentversion_record',
  status: 'acknowledgment_picklist_status',
  deadline: 'acknowledgement_date_deadline_date'
} as const;

/**
 * The real "Monitoring" JSP page in native ECAP embeds a separate Angular app — confirmed
 * blocked from iframing here by that app's own X-Frame-Options/CSP (live test: "refused to
 * connect", which never fires the iframe's error event either). Rebuilt natively instead,
 * reusing the same "ALL ACKNOWLEDGEMENTS for CUI" view already wired into the chase table.
 *
 * Bulk status/deadline change is confirmed real via live network capture: selecting a record
 * and saving a new status + deadline together produced this exact audit trail entry —
 * "Modified Deadline Date from 08/23/2026 to 08/13/2026" and "Modified Acknowledgment Status
 * from Done to Pending" — from a plain record field update (record._recordPermissions.canUpdate
 * was true for the Compliance session), not a macro or BPM action. Applied here per selected
 * record via PUT /networking/solution/ServiceDesk/record/{objectId}/{recordId}, same convention
 * already proven for Information Folder/Organizational Unit updates elsewhere in this app.
 *
 * "Send reminder" is confirmed real via live network capture: clicking it opens a compose
 * dialog (recipients, editable subject, an "Additional information" box the compliance officer
 * types fresh each time — this is where the live capture's "hiii" text actually came from, not
 * a stored record field), then on Send fires POST /networking/rest/class/operation/exec,
 * invoking a server-side Java class (com.platform.labs.information_manager.ReminderEmail.
 * sendReminder) with the full email (emails/subject/body) built client-side — the server just
 * sends whatever HTML it's given, no templating of its own. Reproduced here with the same
 * bilingual DE/EN structure captured live. One deliberate change from the captured version: the
 * CTA link pointed at native ECAP's own record URL (agileapps/records/detail/...); here it
 * points at this app's own /tasks/{id} page instead, since that's where the recipient actually
 * completes the acknowledgement in this app.
 */
@Component({
  selector: 'im-monitoring',
  standalone: true,
  imports: [RouterLink, FormsModule, RecordListDirective, StatusBadgeComponent, PagerComponent, ColumnFilterComponent],
  templateUrl: './monitoring.component.html',
  styleUrl: './monitoring.component.scss'
})
export class MonitoringComponent {
  private readonly http = inject(HttpClient);
  readonly lang = inject(LanguageService);

  readonly statusOptions = STATUS_OPTIONS;

  readonly loading = signal(true);

  constructor() {
    effect(() => {
      this.pageSize(); this.employeeColumnFilter(); this.folderColumnFilter();
      this.versionColumnFilter(); this.statusColumnFilter(); this.deadlineColumnFilter();
      this.nameSearch();
      this.currentPage.set(1);
    }, { allowSignalWrites: true });
    // refreshTick bumps after a bulk save — that refetch should show loading again too, not the empty state.
    effect(() => { this.payloads(); this.loading.set(true); }, { allowSignalWrites: true });
  }

  /** Real server-side filter string, built from whichever columns currently have values selected — see FILTER_FIELD's own doc comment for the confirmed ECAP syntax. */
  private readonly filterQuery = computed(() => {
    const groups: string[] = [];
    const addGroup = (field: string, values: string[]) => {
      if (!values.length) return;
      groups.push('(' + values.map((v) => `${field} equals '${v}'`).join(' OR ') + ')');
    };
    addGroup(FILTER_FIELD.employee, this.employeeColumnFilter());
    addGroup(FILTER_FIELD.folder, this.folderColumnFilter());
    addGroup(FILTER_FIELD.version, this.versionColumnFilter());
    addGroup(FILTER_FIELD.status, this.statusColumnFilter());
    addGroup(FILTER_FIELD.deadline, this.deadlineColumnFilter());
    return groups.join(' AND ');
  });

  readonly payloads = computed<RecordsPayloadMeta[]>(() => {
    this.refreshTick();
    return [{
      id: ACKNOWLEDGEMENT_VIEW_ID.allForCui, object_id: OBJECT_ID.acknowledgement,
      page: 0, pageSize: 200, sortBy: 'date_modified', sortOrder: 'desc',
      getTotalRecordCount: false, filter: this.filterQuery()
    }];
  });

  /** Same view, never filtered — exists only to populate the column filter dropdowns' own option lists (see the ng-container note in the template). */
  readonly optionsPayload = computed<RecordsPayloadMeta>(() => {
    this.refreshTick();
    return {
      id: ACKNOWLEDGEMENT_VIEW_ID.allForCui, object_id: OBJECT_ID.acknowledgement,
      page: 0, pageSize: 200, sortBy: 'date_modified', sortOrder: 'desc',
      getTotalRecordCount: false
    };
  });

  private readonly refreshTick = signal(0);
  private readonly rowsSignal = signal<MonitorRow[]>([]);
  readonly rows = computed(() => {
    const search = this.nameSearch().trim().toLowerCase();
    return this.rowsSignal().filter((r) => !search || r.folderName.toLowerCase().includes(search));
  });
  private readonly optionsRowsSignal = signal<MonitorRow[]>([]);
  readonly optionsRows = computed(() => this.optionsRowsSignal());

  readonly selected = signal<Set<string>>(new Set());

  /** Empty array means "no filter" — every row matches, same convention as im-column-filter's own contract. */
  readonly employeeColumnFilter = signal<string[]>([]);
  readonly folderColumnFilter = signal<string[]>([]);
  readonly versionColumnFilter = signal<string[]>([]);
  readonly statusColumnFilter = signal<string[]>([]);
  readonly deadlineColumnFilter = signal<string[]>([]);
  /**
   * Free-text folder name search — separate from the column filter dropdowns above. Applied
   * client-side (see `rows` below) against whatever's already loaded, not sent to ECAP as a
   * `filter` condition — a `contains`-style operator was tried there first but didn't behave as
   * expected, so this searches the already-fetched rows instead of guessing at unconfirmed ECAP
   * filter syntax a second time.
   */
  readonly nameSearch = signal('');

  /** Drives the single "Reset filters" button — shown only while at least one column filter is active. */
  readonly anyColumnFilterActive = computed(() =>
    !!(this.employeeColumnFilter().length || this.folderColumnFilter().length
      || this.versionColumnFilter().length || this.statusColumnFilter().length
      || this.deadlineColumnFilter().length || this.nameSearch().trim()));

  resetAllColumnFilters(): void {
    this.employeeColumnFilter.set([]);
    this.folderColumnFilter.set([]);
    this.versionColumnFilter.set([]);
    this.statusColumnFilter.set([]);
    this.deadlineColumnFilter.set([]);
    this.nameSearch.set('');
  }

  /**
   * Column filter option lists are derived from the unfiltered optionsRows(), not the
   * server-filtered rows() — otherwise picking a value in one column would shrink what's
   * selectable in the others, since rows() only reflects whatever's currently matched.
   */
  readonly employeeColumnOptions = computed<ColumnFilterOption[]>(() => {
    const names = [...new Set(this.optionsRows().map((r) => r.employee).filter(Boolean))].sort();
    return names.map((n) => ({ value: n, label: n }));
  });
  readonly folderColumnOptions = computed<ColumnFilterOption[]>(() => {
    const names = [...new Set(this.optionsRows().map((r) => r.folderName).filter(Boolean))].sort();
    return names.map((n) => ({ value: n, label: n }));
  });
  /** value is the real documentversion_record value (record_locator) — the field ECAP actually filters on — label is the short version shown everywhere else. */
  readonly versionColumnOptions = computed<ColumnFilterOption[]>(() => {
    const byRaw = new Map<string, string>();
    this.optionsRows().forEach((r) => { if (r.documentVersionRaw) byRaw.set(r.documentVersionRaw, r.documentVersionLabel); });
    return [...byRaw.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([raw, label]) => ({ value: raw, label }));
  });
  readonly deadlineColumnOptions = computed<ColumnFilterOption[]>(() => {
    const deadlines = [...new Set(this.optionsRows().map((r) => r.deadline).filter(Boolean))].sort();
    return deadlines.map((d) => ({ value: d, label: d }));
  });

  private readonly STATUS_COLUMN_LABEL: Record<AckStatus, [string, string]> = {
    None: ['Keine', 'None'], Pending: ['Offen', 'Pending'], Overdue: ['Überfällig', 'Overdue'],
    Done: ['Erledigt', 'Done'], Obsolete: ['Nicht mehr erforderlich', 'Obsolete']
  };
  readonly statusColumnOptions = computed<ColumnFilterOption[]>(() =>
    (['Overdue', 'Pending', 'Done', 'Obsolete', 'None'] as AckStatus[])
      .map((s) => ({ value: s, label: this.STATUS_COLUMN_LABEL[s][this.lang.isGerman() ? 0 : 1] })));

  readonly pageSize = signal(10);
  readonly currentPage = signal(1);

  readonly pagedRows = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.rows().slice(start, start + this.pageSize());
  });

  private mapRow(raw: any): MonitorRow {
    return {
      id: raw.id,
      caseNumber: raw.case_number ?? '',
      employee: raw.acknowledgment_textfield_employee ?? '',
      email: raw.acknowledgment_email_address_email ?? '',
      ownerName: raw.owner_id?.name ?? '',
      documentVersionLabel: versionLabelOf(raw.documentversion_record?.name ?? raw.documentversion_record),
      documentVersionRaw: raw.documentversion_record?.name ?? raw.documentversion_record ?? '',
      acknowledgment_picklist_status: (raw.acknowledgment_picklist_status ?? 'None') as AckStatus,
      deadline: raw.acknowledgement_date_deadline_date ?? '',
      folderName: raw.acknowledgement_textfield_information_folder_name ?? ''
    };
  }

  onResponse(response: RecordsResponseMeta): void {
    this.rowsSignal.set((response.listData?.recordsList ?? []).map((raw: any) => this.mapRow(raw)));
    this.selected.set(new Set());
    this.loading.set(false);
  }

  onError(error: unknown): void {
    console.error('Failed to load Monitoring records', error);
    this.rowsSignal.set([]);
    this.loading.set(false);
  }

  onOptionsResponse(response: RecordsResponseMeta): void {
    this.optionsRowsSignal.set((response.listData?.recordsList ?? []).map((raw: any) => this.mapRow(raw)));
  }

  onOptionsError(error: unknown): void {
    console.error('Failed to load Monitoring filter options', error);
    this.optionsRowsSignal.set([]);
  }

  allSelected(): boolean {
    const rows = this.rows();
    return rows.length > 0 && rows.every((r) => this.selected().has(r.id));
  }

  toggleAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.selected.set(checked ? new Set(this.rows().map((r) => r.id)) : new Set());
  }

  toggleOne(id: string): void {
    this.selected.update((set) => {
      const next = new Set(set);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly saveError = signal('');
  readonly newStatus = signal<AckStatus>('Pending');
  readonly newDeadline = signal('');

  openEdit(): void {
    this.newStatus.set('Pending');
    this.newDeadline.set('');
    this.saveError.set('');
    this.editing.set(true);
  }

  /**
   * Real update, per selected record: fetch the record's own current last_modified_timestamp
   * first (ECAP's optimistic-concurrency token — a numeric epoch string, distinct from the ISO
   * date_modified field), then PUT the new status + deadline with it.
   * The deadline field takes MM/DD/YYYY here — confirmed from the live capture — not the ISO
   * format the generic REST read endpoint uses.
   */
  saveEdit(): void {
    const ids = [...this.selected()];
    if (!ids.length || !this.newDeadline()) return;
    this.saving.set(true);
    this.saveError.set('');

    const deadlineMdY = this.toMonthDayYear(this.newDeadline());
    const status = this.newStatus();

    forkJoin(ids.map((id) => this.updateOne(id, status, deadlineMdY))).subscribe({
      next: () => {
        this.saving.set(false);
        this.editing.set(false);
        this.refreshTick.update((n) => n + 1);
      },
      error: (err) => {
        console.error('Monitoring bulk update failed', err);
        this.saving.set(false);
        this.saveError.set(this.lang.isGerman() ? 'Speichern fehlgeschlagen.' : 'Save failed.');
      }
    });
  }

  private updateOne(id: string, status: AckStatus, deadlineMdY: string) {
    return this.http.get<any>(`/networking/rest/record/${OBJECT_ID.acknowledgement}/${id}`, {
      params: { fieldList: 'last_modified_timestamp', alt: 'json' }
    }).pipe(
      map((response) => response?.platform?.record?.last_modified_timestamp ?? ''),
      switchMap((lastModifiedTimestamp) =>
        this.http.put<any>(`/networking/solution/ServiceDesk/record/${OBJECT_ID.acknowledgement}/${id}`, {
          acknowledgment_picklist_status: status,
          acknowledgement_date_deadline_date: deadlineMdY,
          last_modified_timestamp: lastModifiedTimestamp
        }))
    );
  }

  private toMonthDayYear(isoDate: string): string {
    const [y, m, d] = isoDate.split('-');
    return `${m}/${d}/${y}`;
  }

  readonly remindOpen = signal(false);
  readonly remindRows = signal<MonitorRow[]>([]);
  readonly remindSubject = signal('');
  readonly remindMessage = signal('');
  readonly reminding = signal(false);
  readonly remindError = signal('');
  readonly remindResult = signal<{ sent: number; failed: number } | null>(null);

  /** Subject defaults to the shared folder name when every selected row is the same folder. */
  openRemind(): void {
    const rows = this.rows().filter((r) => this.selected().has(r.id));
    if (!rows.length) return;
    const folders = [...new Set(rows.map((r) => r.folderName))];
    this.remindRows.set(rows);
    this.remindSubject.set(folders.length === 1
      ? `Reminder: Please acknowledge ${folders[0]}`
      : (this.lang.isGerman() ? 'Erinnerung: Bitte Dokumente zur Kenntnis nehmen' : 'Reminder: Please acknowledge your documents'));
    this.remindMessage.set('');
    this.remindError.set('');
    this.remindOpen.set(true);
  }

  /**
   * Each reminder is independent — one failure doesn't block the others, unlike the
   * status/deadline forkJoin, which is applied as one atomic bulk action.
   */
  confirmSendReminders(): void {
    const rows = this.remindRows();
    if (!rows.length) return;
    this.reminding.set(true);
    this.remindError.set('');
    const subject = this.remindSubject();
    const message = this.remindMessage();

    forkJoin(rows.map((row) => this.sendReminderFor(row, subject, message).pipe(
      map(() => true),
      catchError((err) => { console.error('Send reminder failed', row.id, err); return of(false); })
    ))).subscribe({
      next: (results) => {
        this.reminding.set(false);
        this.remindOpen.set(false);
        const sent = results.filter(Boolean).length;
        this.remindResult.set({ sent, failed: results.length - sent });
      }
    });
  }

  private sendReminderFor(row: MonitorRow, subject: string, message: string) {
    return this.http.post<any>('/networking/rest/class/operation/exec', {
      platform: {
        execClass: {
          clazz: 'com.platform.labs.information_manager.ReminderEmail',
          method: 'sendReminder',
          emails: row.email,
          subject,
          body: this.buildReminderHtml(row, message)
        }
      }
    });
  }

  private buildReminderHtml(row: MonitorRow, message: string): string {
    const link = `${window.location.origin}/tasks/${row.id}`;
    const greeting = row.ownerName || row.employee;
    return `<!DOCTYPE html>
<html>
<head>
  <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
  <meta content="width=device-width, initial-scale=1.0" name="viewport" />
</head>
<body style="margin:0;padding:0;background-color:#e0e0e0;">
<table bgcolor="#e0e0e0" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:sans-serif;">
  <tr>
    <td>
      <center style="width:100%;">
        <table align="center" border="0" cellpadding="0" cellspacing="0" width="800">
          <tr>
            <td style="padding:20px 0;text-align:center;background-color:#9FD1CD;">
              <img alt="ESCRIBA Logo" border="0" height="auto"
                src="https://www.escriba.de/wp-content/uploads/2021/03/ESCRIBA_Logo_Weiss_Gelb.png"
                width="400" />
            </td>
          </tr>
        </table>
        <table align="center" bgcolor="#ffffff" border="0" cellpadding="0" cellspacing="0"
          style="border-bottom:20px solid #9FD1CD;background-color:#fff;" width="800">
          <tr>
            <td style="padding:40px;font-family:sans-serif;font-size:15px;line-height:22px;color:#555555;">
              <p>Guten Tag ${greeting},</p>
              <p>wir möchten Sie daran erinnern, folgende Informationen zur Kenntnis zu nehmen:</p>
              <p><strong>Informationsmappe:</strong> ${row.folderName}</p>
              <p><strong>Dokumentversion:</strong> ${row.documentVersionLabel}</p>
              ${message ? `<p>${message}</p>` : ''}
              <p>Bitte lesen Sie diese Informationen und bestätigen Sie deren Erhalt bis zum <strong>${row.deadline}</strong>.<br>Klicken Sie dazu bitte auf untenstehenden Link.</p>
              <p>Sollten Sie Fragen haben, zögern Sie bitte nicht, uns zu kontaktieren.</p>
              <p>Vielen Dank für Ihre Mitarbeit.</p>
              <p>Mit freundlichen Grüßen<br>Compliance Team</p>
              <hr style="border:none;border-top:2px solid #cccccc;margin:24px 0;">
              <p>Dear ${greeting},</p>
              <p>We would like to remind you to take note of the following information:</p>
              <p><strong>Information Folder:</strong> ${row.folderName}</p>
              <p><strong>Document Version:</strong> ${row.documentVersionLabel}</p>
              ${message ? `<p>${message}</p>` : ''}
              <p>Please read this information and confirm receipt by <strong>${row.deadline}</strong>.<br>To do so, please click on the link below.</p>
              <p>If you have any questions, please do not hesitate to contact us.</p>
              <p>Thank you for your cooperation.</p>
              <p>Kind regards,<br>Compliance Team</p>
              <br/>
              <center>
                <a href="${link}"
                   style="display:inline-block;background-color:#9FD1CD;color:#fff;text-decoration:none;padding:12px 28px;border-radius:4px;font-weight:bold;">
                  Acknowledge now
                </a>
              </center>
            </td>
          </tr>
        </table>
      </center>
    </td>
  </tr>
</table>
</body>
</html>`;
  }
}
