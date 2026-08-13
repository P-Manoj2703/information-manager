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

interface MonitorRow {
  id: string;
  caseNumber: string;
  employee: string;
  email: string;
  /** Greeting name for the reminder email — the record's owner_id.name, not the employee text field. */
  ownerName: string;
  documentVersionLabel: string;
  acknowledgment_picklist_status: AckStatus;
  /** MM/DD/YYYY, as ListDataPage and the record-update endpoint both use for this object. */
  deadline: string;
  folderName: string;
}

const STATUS_OPTIONS: AckStatus[] = ['Pending', 'Overdue', 'Done', 'Obsolete', 'None'];

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
  imports: [RouterLink, FormsModule, RecordListDirective, StatusBadgeComponent, PagerComponent],
  styleUrl: './monitoring.component.scss',
  template: `
    @for (payload of payloads(); track $index) {
      <ng-container
        [libEcapRuntimeRecordList]="payload"
        (apiResponseEvent)="onResponse($event)"
        (apiErrorEvent)="onError($event)">
      </ng-container>
    }

    <div class="bar">
      <span class="spacer"></span>
      @if (selected().size) {
        <span class="count">{{ selected().size }} {{ lang.isGerman() ? 'ausgewählt' : 'selected' }}</span>
        <button type="button" class="ghost" (click)="openEdit()">
          {{ lang.isGerman() ? 'Status & Frist ändern' : 'Change status & deadline' }}
        </button>
        <button type="button" class="ghost" (click)="openRemind()">
          {{ lang.isGerman() ? 'Erinnerung senden' : 'Send reminder' }}
        </button>
      }
    </div>

    @if (remindResult(); as r) {
      <p class="note" [class.note--error]="r.failed > 0">
        {{ lang.isGerman() ? r.sent + ' Erinnerung(en) gesendet.' : r.sent + ' reminder(s) sent.' }}
        @if (r.failed > 0) { {{ lang.isGerman() ? r.failed + ' fehlgeschlagen.' : r.failed + ' failed.' }} }
      </p>
    }

    <div class="scroll">
      <table>
        <thead><tr>
          <th><input type="checkbox" [checked]="allSelected()" (change)="toggleAll($event)" /></th>
          <th>{{ lang.isGerman() ? 'Fallnummer' : 'Case' }}</th>
          <th>{{ lang.isGerman() ? 'Mitarbeiter' : 'Employee' }}</th>
          <th>{{ lang.t('folders') }}</th>
          <th>{{ lang.t('version') }}</th>
          <th>{{ lang.t('status') }}</th>
          <th>{{ lang.t('deadline') }}</th>
        </tr></thead>
        <tbody>
          @for (r of pagedRows(); track r.id) {
            <tr>
              <td><input type="checkbox" [checked]="selected().has(r.id)" (change)="toggleOne(r.id)" /></td>
              <td class="mono">{{ r.caseNumber }}</td>
              <td>{{ r.employee }}</td>
              <td>{{ r.folderName }}</td>
              <td class="mono">{{ r.documentVersionLabel }}</td>
              <td><im-status-badge [status]="r.acknowledgment_picklist_status" /></td>
              <td class="tabular">{{ r.deadline }}</td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="empty">
              {{ loading()
                ? (lang.isGerman() ? 'Wird geladen…' : 'Loading…')
                : (lang.isGerman() ? 'Keine Kenntnisnahmen.' : 'No acknowledgements.') }}
            </td></tr>
          }
        </tbody>
      </table>
    </div>
    @if (rows().length) {
      <im-pager [total]="rows().length" [(page)]="currentPage" [(pageSize)]="pageSize" />
    }

    @if (editing()) {
      <div class="backdrop" (click)="editing.set(false)">
        <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
          <h2>{{ lang.isGerman() ? 'Status & Frist ändern' : 'Change status & deadline' }}</h2>
          <p class="note">
            {{ selected().size }} {{ lang.isGerman() ? 'Kenntnisnahmen ausgewählt.' : 'acknowledgements selected.' }}
          </p>
          <label>
            <span class="eyebrow">{{ lang.t('status') }}</span>
            <select [(ngModel)]="newStatus" name="status">
              @for (s of statusOptions; track s) { <option [value]="s">{{ s }}</option> }
            </select>
          </label>
          <label>
            <span class="eyebrow">{{ lang.t('deadline') }}</span>
            <input type="date" [(ngModel)]="newDeadline" name="deadline" />
          </label>
          @if (saveError()) { <p class="note note--error">{{ saveError() }}</p> }
          <footer>
            <button type="button" class="ghost" (click)="editing.set(false)">{{ lang.isGerman() ? 'Abbrechen' : 'Cancel' }}</button>
            <button type="button" class="primary" [disabled]="saving() || !newDeadline()" (click)="saveEdit()">
              {{ saving() ? (lang.isGerman() ? 'Wird gespeichert…' : 'Saving…') : (lang.isGerman() ? 'Speichern' : 'Save') }}
            </button>
          </footer>
        </div>
      </div>
    }

    @if (remindOpen()) {
      <div class="backdrop" (click)="remindOpen.set(false)">
        <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
          <h2>{{ lang.isGerman() ? 'Erinnerungs-E-Mail senden' : 'Send Reminder Email' }}</h2>
          <p class="note">
            {{ remindRows().length }} {{ lang.isGerman() ? 'Empfänger · Erinnerung wird an die E-Mail-Adressen der Mitarbeiter gesendet.' : 'recipient(s) · Reminder will be sent to employee email addresses.' }}
          </p>
          <label>
            <span class="eyebrow">{{ lang.isGerman() ? 'AN' : 'TO' }}</span>
            <div class="chips">
              @for (r of remindRows(); track r.id) { <span class="chip">{{ r.email || r.employee }}</span> }
            </div>
          </label>
          <label>
            <span class="eyebrow">{{ lang.isGerman() ? 'BETREFF' : 'SUBJECT' }}</span>
            <input type="text" [(ngModel)]="remindSubject" name="remindSubject" />
          </label>
          <label>
            <span class="eyebrow">{{ lang.isGerman() ? 'ZUSÄTZLICHE INFORMATIONEN' : 'ADDITIONAL INFORMATION' }}</span>
            <textarea [(ngModel)]="remindMessage" name="remindMessage" rows="5"></textarea>
          </label>
          @if (remindError()) { <p class="note note--error">{{ remindError() }}</p> }
          <footer>
            <button type="button" class="ghost" (click)="remindOpen.set(false)">{{ lang.isGerman() ? 'Abbrechen' : 'Cancel' }}</button>
            <button type="button" class="primary" [disabled]="reminding()" (click)="confirmSendReminders()">
              {{ reminding() ? (lang.isGerman() ? 'Wird gesendet…' : 'Sending…') : (lang.isGerman() ? 'Erinnerung senden' : 'Send Reminder') }}
            </button>
          </footer>
        </div>
      </div>
    }
  `
})
export class MonitoringComponent {
  private readonly http = inject(HttpClient);
  readonly lang = inject(LanguageService);

  readonly statusOptions = STATUS_OPTIONS;

  readonly loading = signal(true);

  constructor() {
    effect(() => { this.pageSize(); this.currentPage.set(1); }, { allowSignalWrites: true });
    // refreshTick bumps after a bulk save — that refetch should show loading again too, not the empty state.
    effect(() => { this.payloads(); this.loading.set(true); }, { allowSignalWrites: true });
  }

  readonly payloads = computed<RecordsPayloadMeta[]>(() => {
    this.refreshTick();
    return [{
      id: ACKNOWLEDGEMENT_VIEW_ID.allForCui, object_id: OBJECT_ID.acknowledgement,
      page: 0, pageSize: 200, sortBy: 'date_modified', sortOrder: 'desc',
      getTotalRecordCount: false
    }];
  });

  private readonly refreshTick = signal(0);
  private readonly rowsSignal = signal<MonitorRow[]>([]);
  readonly rows = computed(() => this.rowsSignal());

  readonly selected = signal<Set<string>>(new Set());

  readonly pageSize = signal(20);
  readonly currentPage = signal(1);

  readonly pagedRows = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.rows().slice(start, start + this.pageSize());
  });

  onResponse(response: RecordsResponseMeta): void {
    const mapped = (response.listData?.recordsList ?? []).map((raw: any): MonitorRow => ({
      id: raw.id,
      caseNumber: raw.case_number ?? '',
      employee: raw.acknowledgment_textfield_employee ?? '',
      email: raw.acknowledgment_email_address_email ?? '',
      ownerName: raw.owner_id?.name ?? '',
      documentVersionLabel: raw.documentversion_record?.name ?? raw.documentversion_record ?? '',
      acknowledgment_picklist_status: (raw.acknowledgment_picklist_status ?? 'None') as AckStatus,
      deadline: raw.acknowledgement_date_deadline_date ?? '',
      folderName: raw.acknowledgement_textfield_information_folder_name ?? ''
    }));
    this.rowsSignal.set(mapped);
    this.selected.set(new Set());
    this.loading.set(false);
  }

  onError(error: unknown): void {
    console.error('Failed to load Monitoring records', error);
    this.rowsSignal.set([]);
    this.loading.set(false);
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
