import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, combineLatest, forkJoin, map, of, switchMap } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { OBJECT_ID } from '@core/objects';
import { SessionService } from '@core/services/session.service';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { AckStatus } from '@core/models/enums';
import { DocumentRow, PdfViewerComponent, documentDownloadUrl } from '@features/acknowledgement/pdf-viewer.component';

interface AckRecord {
  id: string;
  acknowledgment_textfield_employee: string;
  acknowledgement_textfield_information_folder_name: string;
  documentVersionId: string;
  documentVersionLabel: string;
  acknowledgement_date_deadline_date: string;
  acknowledgment_picklist_status: AckStatus;
  description: string;
  /** Real BPM user task id of this record's open "Acknowledge" task, if any — same lookup ack-detail.component.ts uses. */
  taskId: string | null;
  /** Real owning-user id (ECAP's system owner_id) — confirmed live elsewhere in this app (monitoring.component.ts's reminder-email greeting) as the actual assigned recipient, not just the display-text Employee field. */
  assignedUserId: string;
}

/**
 * documentversion_record's displayValue is the full record_locator ("{folder name} - {version}")
 * — only the part after the last " - " is the version itself, same parsing already proven for
 * this same "{name} - {version}" shape in version-timeline.component.ts.
 */
function versionLabelOf(displayValue: string | undefined): string {
  return (displayValue ?? '').split(' - ').pop() || '';
}

/**
 * Real record view for a single acknowledgement, reached from the chase table. Fetched via
 * single-record GET (always reliable in this tenant, unlike the generic list endpoint) rather
 * than filtering a bulk fetch — mirrors every other record-detail screen in this app.
 *
 * Field set: ECAP's own Default Layout rule "CU-Disable and Hide Fields" (condition "true" —
 * applies to every viewer) permanently hides Email, User, Information Folder, Information
 * Folder Created By, Responsible Team, and the "User Information" message on this object's own
 * record page, leaving Employee/Document Version/Description/Acknowledgment Status/Deadline
 * Date as the only Basic Information fields ever shown there. Created By/Modified By/Date
 * Created/Date Modified are technically still visible on ECAP's own page (just read-only), but
 * dropped here too per explicit request — this screen intentionally shows less than ECAP does.
 *
 * Also shows the same PdfViewerComponent + document list, and the same "confirm reading" task
 * panel with a real, working Confirm button, that the recipient gets on their own "My
 * Acknowledgments" detail page (ack-detail.component.ts) — same taskId lookup, same
 * PUT .../record/tasks/{taskId}/complete call. Compliance is the one exception: per explicit
 * request they see the document/PDF itself only when the acknowledgement is actually assigned
 * to them (canSeeDocuments, same assignedUserId check as canConfirm below) — every other
 * acknowledgement they browse from the chase table shows metadata only. Information Provider
 * always sees both, regardless of assignment. But the Confirm button itself is gated to
 * assignedUserId === the current session's own user id — same real-world restriction ECAP's own
 * "My User Acknowledgments" view has: an Information Provider can see every acknowledgement
 * generated from their own policies, but can only actually complete the ones assigned to
 * themselves. Viewing someone else's record here is always read-only.
 *
 * A successful confirm replaces the entire page with a standalone receipt (no back link, no
 * metadata card, no PDF viewer) — same standalone-page shape as the recipient's own
 * /tasks/:id/receipt, just with richer real fields since this is an admin action worth a fuller
 * audit trail. "Confirmed by" is this session's real user (the one who clicked Confirm), not
 * the record's own Employee field. justConfirmed resets on every id change so navigating to a
 * different acknowledgement doesn't show a stale receipt for the previous one.
 */
@Component({
  selector: 'im-ack-record-detail',
  standalone: true,
  imports: [RouterLink, StatusBadgeComponent, PdfViewerComponent],
  templateUrl: './ack-record-detail.component.html',
  styleUrl: './ack-record-detail.component.scss'
})
export class AckRecordDetailComponent {
  private readonly http = inject(HttpClient);
  readonly lang = inject(LanguageService);
  readonly session = inject(SessionService);

  readonly id = input.required<string>();
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly confirmError = signal('');
  /** The real reason the record fetch came back empty (e.g. a genuine ECAP ACL denial) — shown instead of a generic "not found". */
  readonly fetchError = signal('');

  readonly documents = signal<DocumentRow[]>([]);
  readonly selectedDocId = signal<string | null>(null);

  readonly justConfirmed = signal(false);
  readonly confirmedAt = signal('');

  /** Bumped after a successful confirm so the record re-fetches in place, instead of navigating away like the recipient's own receipt flow does. */
  private readonly refreshTick = signal(0);

  constructor() {
    effect(() => { this.id(); this.justConfirmed.set(false); }, { allowSignalWrites: true });
  }

  downloadUrl(versionId: string, documentId: string): string {
    return documentDownloadUrl(versionId, documentId);
  }

  readonly ack = toSignal(
    combineLatest([toObservable(this.id), toObservable(this.refreshTick)]).pipe(
      switchMap(([id]) => this.fetchAck(id)),
      map((a) => { this.loading.set(false); return a; })
    ),
    { initialValue: null as AckRecord | null }
  );

  /**
   * Same taskId lookup and PUT .../complete call as ack-detail.component.ts's confirm().
   * The record GET returns a normal 200 either way — success carries platform.record plus a
   * "code":"0" message, a rejection (e.g. real ECAP ACL denial) carries no record at all, just
   * platform.message with a non-zero code and the real reason (confirmed live: "-1" / "You do
   * not have permission for this operation") — so that message is read explicitly here rather
   * than relying on catchError, which a plain 200 response never triggers.
   */
  private fetchAck(id: string): Observable<AckRecord | null> {
    if (!id) return of(null);
    this.fetchError.set('');
    return forkJoin({
      record: this.http.get<any>(`/networking/rest/record/${OBJECT_ID.acknowledgement}/${id}`, { params: { alt: 'json' } })
        .pipe(map((r) => {
          if (r?.platform?.record) return r.platform.record;
          this.fetchError.set(r?.platform?.message?.description ?? '');
          return null;
        })),
      tasks: this.http.get<any>('/networking/solution/ServiceDesk/CaseRecordPage', {
        params: { id, object_id: OBJECT_ID.acknowledgement, _component_: 'tasksInfo' }
      }).pipe(catchError(() => of(null)))
    }).pipe(
      map(({ record: r, tasks }): AckRecord | null => {
        if (!r) return null;
        const openTask = [
          ...(tasks?.tasksInfo?.myTasks ?? []),
          ...(tasks?.tasksInfo?.otherTasks ?? [])
        ].find((t: any) => t.subject === 'Acknowledge' && !t.date_completed);
        return {
          id: r.id,
          acknowledgment_textfield_employee: r.acknowledgment_textfield_employee ?? '',
          acknowledgement_textfield_information_folder_name: r.acknowledgement_textfield_information_folder_name ?? '',
          documentVersionId: r.documentversion_record?.content ?? '',
          documentVersionLabel: versionLabelOf(r.documentversion_record?.displayValue),
          acknowledgement_date_deadline_date: r.acknowledgement_date_deadline_date ?? '',
          // Picklist fields come back as {displayValue, content} objects from this endpoint, not plain strings.
          acknowledgment_picklist_status: (r.acknowledgment_picklist_status?.content ?? 'None') as AckStatus,
          description: r.description ?? '',
          taskId: openTask?.id ?? null,
          assignedUserId: r.owner_id?.content ?? r.owner_id?.id ?? ''
        };
      }),
      catchError((err) => {
        console.error('Acknowledgement fetch failed', err);
        this.fetchError.set(err?.error?.platform?.message?.description ?? err?.error?.__exception_msg__ ?? '');
        return of(null);
      })
    );
  }

  /** Only the acknowledgement's real assigned recipient (session userId === owner_id) may complete it here — everyone else gets a read-only view. */
  canConfirm(a: AckRecord): boolean {
    return !!a.taskId && a.assignedUserId === this.session.session().userId;
  }

  /**
   * Compliance can browse every acknowledgement from the chase table, but per explicit request
   * only ever sees the document itself when it's the one actually assigned to them — otherwise
   * metadata only. Every other role (Information Provider) always sees the document.
   */
  canSeeDocuments(a: AckRecord): boolean {
    if (this.session.role() !== 'complianceverantwortlicher') return true;
    return a.assignedUserId === this.session.session().userId;
  }

  confirm(a: AckRecord): void {
    if (!this.canConfirm(a) || this.busy()) return;
    this.busy.set(true);
    this.confirmError.set('');
    this.http.put<any>(
      `/networking/solution/ServiceDesk/record/tasks/${a.taskId}/complete`,
      { action: 'complete', note: '', done: `ServiceDesk/CaseRecordPage?id=${a.id}&object_id=${OBJECT_ID.acknowledgement}` }
    ).subscribe({
      next: () => {
        this.busy.set(false);
        this.confirmedAt.set(new Date().toLocaleString('de-DE'));
        this.justConfirmed.set(true);
        this.refreshTick.update((n) => n + 1);
      },
      error: (err) => {
        console.error('Acknowledge task completion failed', err);
        this.busy.set(false);
        this.confirmError.set(err?.error?.platform?.message?.description
          || (this.lang.isGerman() ? 'Bestätigung fehlgeschlagen.' : 'Confirmation failed.'));
      }
    });
  }
}
