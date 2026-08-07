import { Component, inject, input } from '@angular/core';
import { LanguageService } from '@core/i18n/language.service';
import { SessionService } from '@core/services/session.service';
import { API_BASE, OBJECT_ID } from '@core/objects';

/**
 * Inline viewer — compliance must not depend on a download (UC-REC-03).
 * "Download all" hits the custom form action downloadAllFiles.
 * No real DMS file is served against mock data yet, so the body renders a
 * static page mockup rather than pointing an iframe at a non-existent file.
 */
@Component({
  selector: 'im-pdf-viewer',
  standalone: true,
  styles: [`
    :host { display: block; }
    .frame { background: #fff; border: 1px solid var(--border-1); border-radius: var(--radius-card); overflow: hidden; }
    .bar { display: flex; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid var(--border-1); }
    .bar strong { font-size: 14px; }
    .bar .spacer { margin-left: auto; }
    .ghost {
      border: 1px solid var(--border-2); background: #fff; color: var(--fg-2); cursor: pointer;
      font: inherit; font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: var(--radius-pill);
    }
    .preview { display: flex; flex-direction: column; align-items: center; gap: 12px;
               padding: 32px; background: #e8ebed; }
    .page { width: 100%; max-width: 420px; min-height: 460px; background: #fff;
            border: 1px solid var(--border-1); border-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,.08);
            padding: 28px 24px; display: flex; flex-direction: column; gap: 10px; }
    .page__line { height: 8px; border-radius: 2px; background: var(--bg-2); }
    .page__line--title { width: 60%; height: 14px; margin-bottom: 8px; }
    .page__line--short { width: 40%; }
    .page__spacer { height: 18px; }
    .preview__caption { font-size: 12px; color: var(--fg-3); }
  `],
  template: `
    <div class="frame">
      <div class="bar">
        <strong>{{ lang.isGerman() ? 'Dokument' : 'Document' }}</strong>
        <span class="spacer"></span>
        @if (canDownloadAll()) {
          <button type="button" class="ghost" (click)="downloadAll()">{{ lang.t('downloadAll') }}</button>
        }
      </div>
      <div class="preview">
        <div class="page">
          <div class="page__line page__line--title"></div>
          <div class="page__line"></div>
          <div class="page__line"></div>
          <div class="page__line page__line--short"></div>
          <div class="page__spacer"></div>
          <div class="page__line"></div>
          <div class="page__line"></div>
          <div class="page__line page__line--short"></div>
        </div>
        <p class="preview__caption">
          {{ lang.isGerman() ? 'Dokumentvorschau · Version' : 'Document preview · version' }} {{ versionId() }}
        </p>
      </div>
    </div>
  `
})
export class PdfViewerComponent {
  readonly lang = inject(LanguageService);
  private readonly session = inject(SessionService);
  readonly versionId = input.required<string>();
  readonly canDownloadAll = input(true);

  downloadAll(): void {
    window.location.href =
      `${API_BASE}/dms/${OBJECT_ID.documentVersion}/${this.versionId()}/folder/root/download`;
  }
}
