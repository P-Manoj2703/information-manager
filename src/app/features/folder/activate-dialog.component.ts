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
  styles: [`
    .card { background:#fff; border:1px solid var(--border-1); border-radius:var(--radius-card);
            padding:28px 32px; max-width:640px; display:flex; flex-direction:column; gap:18px; }
    h2 { margin:0; font-size:22px; font-weight:300; }
    p { margin:0; font-size:14px; line-height:1.7; color:var(--fg-2); }
    .warn { background:#fdf6ec; border:1px solid #f6e0c0; border-radius:var(--radius-input);
            padding:14px 16px; font-size:13px; color:#8a5a20; line-height:1.6; }
    .error { background:#fdf0f0; border:1px solid #f3d6d6; border-radius:var(--radius-input);
             padding:12px 16px; font-size:12px; color:var(--danger); line-height:1.5; }
    .primary { border:0; cursor:pointer; font:inherit; font-size:15px; font-weight:600;
               background:var(--escriba-teal); color:var(--navy-900); padding:14px 24px; border-radius:var(--radius-pill); }
    .ghost { border:1px solid var(--border-2); background:#fff; color:var(--fg-2); cursor:pointer;
             font:inherit; font-size:14px; font-weight:600; padding:12px 20px; border-radius:var(--radius-pill); }
    h2 .step-num { color:var(--escriba-teal-700); font-weight:700; }
    .checklist { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; }
    .checklist li { display:flex; align-items:center; gap:14px; padding:14px 0; border-bottom:1px solid var(--border-1); }
    .checklist li:last-child { border-bottom:0; }
    .status { flex:0 0 auto; width:22px; height:22px; border-radius:50%; display:grid; place-items:center;
               font-size:12px; font-weight:700; background:var(--bg-mint); color:var(--escriba-teal-700); }
    .status--warn { background:#fdf6ec; color:#8a5a20; }
    .label { flex:1 1 auto; font-size:14px; color:var(--fg-1); }
    .value { flex:0 0 auto; font-size:14px; color:var(--fg-2); }
    footer { display:flex; flex-wrap:wrap; align-items:center; gap:16px; padding-top:8px; }
    .spacer { flex:1; }
    .overlay { position:fixed; inset:0; background:rgba(20,30,40,.45); display:grid; place-items:center; z-index:100; }
    .modal { background:#fff; border-radius:var(--radius-card); padding:28px 32px; max-width:520px; width:90vw;
             display:flex; flex-direction:column; gap:18px; box-shadow:0 12px 40px rgba(0,0,0,.25); }
    .details { border:1px solid var(--border-1); border-radius:var(--radius-input); padding:4px 16px; }
    .details__row { display:flex; justify-content:space-between; gap:16px; padding:12px 0; border-bottom:1px solid var(--border-1); font-size:14px; }
    .details__row:last-child { border-bottom:0; }
    .details__row span:first-child { color:var(--fg-3); }
    .details__row span:last-child { font-weight:600; color:var(--fg-1); }
  `],
  template: `
    <section class="card">
        <h2><span class="step-num">4</span> · {{ lang.isGerman() ? 'Veröffentlichen' : 'Publish' }}</h2>

        <ul class="checklist">
          <li>
            <span class="status" [class.status--warn]="!versionLabel()">{{ versionLabel() ? '✓' : '!' }}</span>
            <span class="label">{{ lang.isGerman() ? 'Aktive Dokumentversion vorhanden' : 'Active document version present' }}</span>
            <span class="value">{{ versionLabel() || '—' }}</span>
          </li>
          <li>
            <span class="status" [class.status--warn]="teamCount() + userCount() === 0">{{ teamCount() + userCount() > 0 ? '✓' : '!' }}</span>
            <span class="label">{{ lang.isGerman() ? 'Zielgruppe verknüpft' : 'Audience linked' }}</span>
            <span class="value">{{ teamCount() }} (OU), {{ userCount() }} {{ lang.isGerman() ? 'Benutzer' : 'Users' }}</span>
          </li>
          <li>
            <span class="status">✓</span>
            <span class="label">{{ lang.isGerman() ? 'Frist' : 'Deadline' }}</span>
            <span class="value">{{ deadlineDays() }} {{ lang.isGerman() ? 'Tage' : 'days' }} → {{ targetDate() }}</span>
          </li>
          <li>
            <span class="status status--warn">!</span>
            <span class="label">{{ lang.isGerman() ? 'Vertraulichkeit geprüft' : 'Confidentiality reviewed' }}</span>
            <span class="value">{{ confidentialityLevel() }}</span>
          </li>
        </ul>

        <footer>
          <button type="button" class="ghost" (click)="back.emit()">{{ lang.isGerman() ? 'Zurück' : 'Back' }}</button>
          <span class="spacer"></span>
          <button class="primary" [disabled]="!versionId()" (click)="showConfirm.set(true)">
            {{ lang.isGerman() ? 'Version aktivieren' : 'Activate version' }}
          </button>
        </footer>

        @if (showConfirm()) {
          <div class="overlay" (click)="!busy() && showConfirm.set(false)">
            <div class="modal" (click)="$event.stopPropagation()">
              <h2>{{ lang.isGerman() ? 'Version aktivieren?' : 'Activate version?' }}</h2>
              <p>
                {{ lang.isGerman()
                  ? 'Die Aktivierung erstellt ' + userCount() + ' Kenntnisnahmen und versendet ' + userCount() + ' E-Mails. Empfänger haben ' + deadlineDays() + ' Tage, bis ' + targetDateDMY() + '.'
                  : 'Activating creates ' + userCount() + ' acknowledgements and sends ' + userCount() + ' emails. Recipients have ' + deadlineDays() + ' days, until ' + targetDateDMY() + '.' }}
              </p>
              @if (supersedes()) {
                <p class="warn">
                  {{ lang.isGerman()
                    ? supersededConfirmedCount() + ' Personen haben ' + supersedes() + ' bereits bestätigt und werden erneut gefragt — Kenntnisnahme ist versionsbezogen. Version ' + supersedes() + ' wird gleichzeitig deaktiviert.'
                    : supersededConfirmedCount() + ' people already confirmed ' + supersedes() + ' and will be asked again — acknowledgement is per version. Version ' + supersedes() + ' is deactivated at the same time.' }}
                </p>
              }
              <div class="details">
                <div class="details__row">
                  <span>{{ lang.isGerman() ? 'Neue Kenntnisnahmen' : 'New acknowledgements' }}</span>
                  <span>{{ userCount() }}</span>
                </div>
                @if (supersedes()) {
                  <div class="details__row">
                    <span>{{ lang.isGerman() ? 'Ersetzte Version' : 'Superseded version' }}</span>
                    <span>{{ supersedes() }}</span>
                  </div>
                }
                <div class="details__row">
                  <span>{{ lang.isGerman() ? 'Frist' : 'Deadline' }}</span>
                  <span>{{ targetDateDMY() }}</span>
                </div>
                <div class="details__row">
                  <span>{{ lang.isGerman() ? 'E-Mail-Vorlage' : 'Email template' }}</span>
                  <span>Acknowledge Notification At Creation</span>
                </div>
              </div>
              @if (activateError()) { <p class="error">{{ activateError() }}</p> }
              <footer>
                <button type="button" class="ghost" [disabled]="busy()" (click)="showConfirm.set(false)">
                  {{ lang.isGerman() ? 'Abbrechen' : 'Cancel' }}
                </button>
                <span class="spacer"></span>
                <button class="primary" [disabled]="busy()" (click)="activate()">
                  {{ busy()
                    ? (lang.isGerman() ? 'Wird aktiviert…' : 'Activating…')
                    : (lang.isGerman() ? 'Aktivieren und benachrichtigen' : 'Activate and notify') }}
                </button>
              </footer>
            </div>
          </div>
        }
    </section>
  `
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
