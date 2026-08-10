import { Component, inject, input, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, map, of, switchMap } from 'rxjs';
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
 * macro-invocation conventions in this tenant). That macro only flips
 * version_picklist_version_status to 'Active'; the acknowledgement rows it
 * triggers server-side (VersionUtil.syncAcknowledgementsForFolderActiveVersion)
 * are counted with a follow-up read rather than trusted from the macro's own
 * response, since the macro call itself returns no such count.
 */
@Component({
  selector: 'im-activate-dialog',
  standalone: true,
  styles: [`
    .card { background:#fff; border:1px solid var(--border-1); border-radius:var(--radius-card);
            padding:28px 32px; max-width:640px; display:flex; flex-direction:column; gap:18px; }
    h2 { margin:0; font-size:22px; font-weight:300; }
    p { margin:0; font-size:14px; line-height:1.7; color:var(--fg-2); }
    .warn { background:#fdf6ec; border:1px solid #f6e0c0; border-radius:var(--radius-input);
            padding:14px 16px; font-size:13px; color:#8a5a20; line-height:1.6; }
    .error { background:#fdf0f0; border:1px solid #f3d6d6; border-radius:var(--radius-input);
             padding:12px 16px; font-size:12px; color:var(--danger); line-height:1.5; }
    .primary { align-self:flex-end; border:0; cursor:pointer; font:inherit; font-size:15px; font-weight:600;
               background:var(--escriba-teal); color:var(--navy-900); padding:14px 24px; border-radius:var(--radius-pill); }
    .receipt { background:var(--bg-mint); border-radius:var(--radius-input); padding:16px 18px;
               color:var(--escriba-teal-700); font-size:14px; }
  `],
  template: `
    <section class="card">
      @if (result(); as r) {
        <h2>{{ lang.isGerman() ? 'Veröffentlicht' : 'Published' }}</h2>
        <p class="receipt">
          {{ r.acknowledgementsCreated }}
          {{ lang.isGerman() ? 'Kenntnisnahmen angelegt und E-Mails versendet.' : 'acknowledgements created and emails sent.' }}
        </p>
      } @else {
        <h2>{{ lang.isGerman() ? 'Version aktivieren?' : 'Activate version?' }}</h2>
        <p>
          {{ lang.isGerman()
            ? 'Die Aktivierung benachrichtigt ' + teamCount() + ' Organisationseinheit(en) und ' + userCount() + ' Benutzer — es werden ' + userCount() + ' Kenntnisnahmen angelegt und ebenso viele E-Mails versendet. Die Empfänger haben ' + deadlineDays() + ' Tage Zeit.'
            : 'Activating notifies ' + teamCount() + ' organisational unit(s) and ' + userCount() + ' users — ' + userCount() + ' acknowledgements will be created and as many emails sent. Recipients have ' + deadlineDays() + ' days.' }}
        </p>
        @if (supersedes()) {
          <p class="warn">
            {{ lang.isGerman()
              ? 'Version ' + supersedes() + ' wird deaktiviert, ihre Kenntnisnahmen werden obsolet, und alle Empfänger werden erneut gefragt — auch die, die bereits bestätigt haben.'
              : 'Version ' + supersedes() + ' is deactivated, its acknowledgements become obsolete, and every recipient is asked again — including those who already confirmed.' }}
          </p>
        }
        @if (activateError()) { <p class="error">{{ activateError() }}</p> }
        <button class="primary" [disabled]="busy() || !versionId()" (click)="activate()">
          {{ lang.isGerman() ? 'Aktivieren und benachrichtigen' : 'Activate and notify' }}
        </button>
      }
    </section>
  `
})
export class ActivateDialogComponent {
  private readonly http = inject(HttpClient);
  readonly lang = inject(LanguageService);

  readonly folderId = input.required<string>();
  readonly versionId = input<string>('');
  readonly teamCount = input.required<number>();
  readonly userCount = input.required<number>();
  readonly deadlineDays = input.required<number>();
  readonly supersedes = input<string | null>(null);

  readonly busy = signal(false);
  readonly activateError = signal('');
  readonly result = signal<{ acknowledgementsCreated: number } | null>(null);

  activate(): void {
    const versionId = this.versionId();
    if (!versionId || this.busy()) return;
    this.busy.set(true);
    this.activateError.set('');

    this.http.post<any>(
      `${API_BASE}/record/${OBJECT_ID.documentVersion}/${versionId}/execMacro/${DOCUMENT_VERSION_ACTIVATE_MACRO_ID}`, {}
    ).pipe(
      // catchError only guards the count read — a failure here must NOT be treated as
      // "0 acknowledgements found" success; it must still surface as a real activation
      // failure below, which it does since this inner pipe never touches the outer one's
      // own error channel when the POST itself is what failed.
      switchMap(() => this.http.get<any>(`/networking/rest/record/${OBJECT_ID.acknowledgement}`, {
        params: {
          filter: `(documentversion_record equals '${versionId}')`,
          fieldList: 'id', pageSize: 1, getTotalRecordCount: true, alt: 'json'
        }
      }).pipe(
        map((r) => Number(r?.platform?.totalRecordCount ?? 0)),
        catchError((err) => { console.error('Acknowledgement count fetch failed', err); return of(0); })
      ))
    ).subscribe({
      next: (acknowledgementsCreated) => { this.result.set({ acknowledgementsCreated }); this.busy.set(false); },
      error: (err) => {
        console.error('Activate Document Version failed', err);
        this.busy.set(false);
        // execMacro errors nest the real message under platform.message.description, not __exception_msg__.
        this.activateError.set(err?.error?.platform?.message?.description ?? (this.lang.isGerman() ? 'Aktivierung fehlgeschlagen.' : 'Activation failed.'));
      }
    });
  }
}
