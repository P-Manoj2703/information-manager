import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { catchError, map, of } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { API_BASE, DOCUMENT_VERSION_ACTIVATE_MACRO_ID, OBJECT_ID } from '@core/objects';

/**
 * UC-IP-04 / UC-IP-05. Publishing is a blast-radius action: state N before the
 * click, and warn that people who confirmed the previous version are re-asked.
 *
 * Activation itself is the real "Activate Document Version" macro — confirmed
 * live via network capture of the native macro button:
 * POST rest/record/{objectId}/{recordId}/execMacro/{macroId}, a different URL
 * shape than Information Folder's Activate/Deactivate (those go through
 * rest/macro/{slug}/{recordId} instead — the two object types use different
 * macro-invocation conventions in this tenant). The body must be
 * `{ params: {} }`, not a bare `{}` — confirmed live that a bare `{}` still
 * gets a 200 back but silently no-ops server-side (version_picklist_version_status
 * never actually flips), while the native button's `{"params":{}}` body is what
 * makes the macro really run. On success we navigate straight to the folder
 * detail page, which reads the real, freshly-created acknowledgement rows
 * itself (VersionUtil.syncAcknowledgementsForFolderActiveVersion) rather than
 * us trying to report a count here — the macro's own response carries none.
 */
@Component({
  selector: 'im-activate-dialog',
  standalone: true,
  templateUrl: './activate-dialog.component.html',
  styleUrl: './activate-dialog.component.scss'
})
export class ActivateDialogComponent {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  readonly lang = inject(LanguageService);

  readonly folderId = input.required<string>();
  readonly versionId = input<string>('');
  readonly teamCount = input.required<number>();
  readonly userCount = input.required<number>();
  readonly deadlineDays = input.required<number>();
  readonly confidentialityLevel = input<string>('');
  readonly supersedes = input<string | null>(null);
  readonly supersededConfirmedCount = input<number>(0);
  readonly back = output<void>();

  readonly busy = signal(false);
  readonly activateError = signal('');
  readonly showConfirm = signal(false);
  /** The version's own label (e.g. "v1.0") — fetched once versionId is available, same field the upload step wrote it to. */
  readonly versionLabel = signal('');
  private readonly targetDateValue = computed(() => {
    const d = new Date();
    d.setDate(d.getDate() + this.deadlineDays());
    return d;
  });
  readonly targetDate = computed(() => this.targetDateValue().toISOString().slice(0, 10));
  readonly targetDateDMY = computed(() => {
    const d = this.targetDateValue();
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  });

  constructor() {
    effect(() => {
      const versionId = this.versionId();
      if (!versionId) return;
      this.http.get<any>(`/networking/rest/record/${OBJECT_ID.documentVersion}/${versionId}`, {
        params: { fieldList: 'version_text_field_version_id', alt: 'json' }
      }).pipe(
        map((r) => r?.platform?.record?.version_text_field_version_id ?? ''),
        catchError((err) => { console.error('Version label fetch failed', err); return of(''); })
      ).subscribe((label) => this.versionLabel.set(label));
    });
  }

  activate(): void {
    const versionId = this.versionId();
    if (!versionId || this.busy()) return;
    this.busy.set(true);
    this.activateError.set('');

    this.http.post<any>(
      `${API_BASE}/record/${OBJECT_ID.documentVersion}/${versionId}/execMacro/${DOCUMENT_VERSION_ACTIVATE_MACRO_ID}`, { params: {} }
    ).subscribe({
      next: () => this.router.navigate(['/folders', this.folderId()]),
      error: (err) => {
        console.error('Activate Document Version failed', err);
        this.busy.set(false);
        // execMacro errors nest the real message under platform.message.description, not __exception_msg__.
        this.activateError.set(err?.error?.platform?.message?.description ?? (this.lang.isGerman() ? 'Aktivierung fehlgeschlagen.' : 'Activation failed.'));
      }
    });
  }
}
