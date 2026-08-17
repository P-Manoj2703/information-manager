import { Component, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { OBJECT_ID } from '@core/objects';
import { AckStatus } from '@core/models';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { DocumentRow, PdfViewerComponent, documentDownloadUrl } from './pdf-viewer.component';

interface AckDetailRecord {
  id: string;
  acknowledgment_picklist_status: AckStatus;
  acknowledgement_date_deadline_date: string;
  acknowledgement_textfield_information_folder_name: string;
  documentVersionId: string;
  documentVersionLabel: string;
  acknowledgment_richtextarea_user_information: string;
  /** Real BPM user task id of this record's "Acknowledge" task, if one is currently open and assigned to this user. */
  taskId: string | null;
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
 * UC-REC-03 / UC-REC-04. The recipient has no update right on the record — the only real
 * state change is completing the BPM "Acknowledge" user task via
 * PUT .../record/tasks/{taskId}/complete, same mechanism already proven for the Distribution
 * Template task (audience-builder.component.ts). Fetched via the generic single-record REST
 * GET (reliable for single records in this tenant, unlike its list form) plus a CaseRecordPage
 * tasksInfo lookup for the task id.
 */
@Component({
  selector: 'im-ack-detail',
  standalone: true,
  imports: [RouterLink, StatusBadgeComponent, PdfViewerComponent],
  templateUrl: './ack-detail.component.html',
  styleUrl: './ack-detail.component.scss'
})
export class AckDetailComponent {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  readonly lang = inject(LanguageService);

  /** Bound from the route via withComponentInputBinding(). */
  readonly id = input.required<string>();
  readonly busy = signal(false);
  readonly loading = signal(true);
  readonly error = signal('');

  readonly documents = signal<DocumentRow[]>([]);
  readonly selectedDocId = signal<string | null>(null);

  downloadUrl(versionId: string, documentId: string): string {
    return documentDownloadUrl(versionId, documentId);
  }

  readonly ack = toSignal(
    toObservable(this.id).pipe(
      switchMap((id) => this.fetchAck(id)),
      map((a) => { this.loading.set(false); return a; })
    ),
    { initialValue: null as AckDetailRecord | null }
  );

  private fetchAck(id: string): Observable<AckDetailRecord | null> {
    if (!id) return of(null);
    return forkJoin({
      record: this.http.get<any>(`/networking/rest/record/${OBJECT_ID.acknowledgement}/${id}`, { params: { alt: 'json' } })
        .pipe(map((r) => r?.platform?.record ?? null)),
      tasks: this.http.get<any>('/networking/solution/ServiceDesk/CaseRecordPage', {
        params: { id, object_id: OBJECT_ID.acknowledgement, _component_: 'tasksInfo' }
      }).pipe(catchError(() => of(null)))
    }).pipe(
      map(({ record: r, tasks }): AckDetailRecord | null => {
        if (!r) return null;
        const openTask = [
          ...(tasks?.tasksInfo?.myTasks ?? []),
          ...(tasks?.tasksInfo?.otherTasks ?? [])
        ].find((t: any) => t.subject === 'Acknowledge' && !t.date_completed);
        return {
          id: r.id,
          // Picklist fields come back as {displayValue, content} objects from this endpoint, not plain strings.
          acknowledgment_picklist_status: (r.acknowledgment_picklist_status?.content ?? 'None') as AckStatus,
          acknowledgement_date_deadline_date: r.acknowledgement_date_deadline_date ?? '',
          acknowledgement_textfield_information_folder_name: r.acknowledgement_textfield_information_folder_name ?? '',
          documentVersionId: r.documentversion_record?.content ?? '',
          documentVersionLabel: versionLabelOf(r.documentversion_record?.displayValue),
          acknowledgment_richtextarea_user_information: r.acknowledgment_richtextarea_user_information ?? '',
          taskId: openTask?.id ?? null
        };
      }),
      catchError((err) => { console.error('Acknowledgement fetch failed', err); return of(null); })
    );
  }

  confirm(a: AckDetailRecord): void {
    if (!a.taskId) return;
    this.busy.set(true);
    this.error.set('');
    this.http.put<any>(
      `/networking/solution/ServiceDesk/record/tasks/${a.taskId}/complete`,
      { action: 'complete', note: '', done: `ServiceDesk/CaseRecordPage?id=${a.id}&object_id=${OBJECT_ID.acknowledgement}` }
    ).subscribe({
      next: () => this.router.navigate(['/tasks', a.id, 'receipt']),
      error: (err) => {
        console.error('Acknowledge task completion failed', err);
        this.busy.set(false);
        this.error.set(err?.error?.platform?.message?.description
          || (this.lang.isGerman() ? 'Bestätigung fehlgeschlagen.' : 'Confirmation failed.'));
      }
    });
  }
}
