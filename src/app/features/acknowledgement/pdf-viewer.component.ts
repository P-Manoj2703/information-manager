import { Component, DestroyRef, inject, input, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { OBJECT_ID } from '@core/objects';

interface DocumentRow { id: string; name: string; fileExtension: string }

/**
 * Real document list for the acknowledgement's linked Document Version, via the same
 * dmsListPage endpoint proven for Document Version's own "Add document" panel
 * (version-detail.component.ts). The real download endpoint always answers with
 * Content-Disposition: attachment (confirmed live) — a plain <a href> or <iframe src>
 * against it always forces a download, never an inline view. To let the recipient actually
 * read the document in place, "Preview" fetches the same bytes as a blob via HttpClient
 * (Content-Disposition only governs browser-native navigation, not XHR/fetch) and renders
 * that blob in an iframe; "Download" keeps using the real endpoint directly.
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
    .files { list-style: none; margin: 0; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .file { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border: 1px solid var(--border-1);
            border-radius: var(--radius-input); }
    .file--active { border-color: var(--escriba-teal); }
    .file__name { font-size: 13px; flex: 1; overflow-wrap: anywhere; }
    .file__actions { display: flex; gap: 8px; flex-shrink: 0; }
    .ghost {
      border: 1px solid var(--border-2); background: #fff; color: var(--fg-2); cursor: pointer; text-decoration: none;
      font: inherit; font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: var(--radius-pill);
      white-space: nowrap;
    }
    .ghost--active { border-color: var(--escriba-teal); color: var(--escriba-teal); }
    .empty { padding: 32px; text-align: center; color: var(--fg-3); font-size: 13px; }
    .preview { border-top: 1px solid var(--border-1); }
    .preview__bar { display: flex; align-items: center; gap: 12px; padding: 10px 20px; background: var(--bg-2); }
    .preview__bar strong { font-size: 13px; flex: 1; overflow-wrap: anywhere; }
    .preview__frame { width: 100%; height: 70vh; border: 0; display: block; }
    .preview__status { padding: 32px; text-align: center; color: var(--fg-3); font-size: 13px; }
  `],
  template: `
    <div class="frame">
      <div class="bar">
        <strong>{{ lang.isGerman() ? 'Dokument' : 'Document' }}</strong>
        <span class="spacer"></span>
        @if (canDownloadAll() && documents().length > 1) {
          <button type="button" class="ghost" (click)="downloadAll()">{{ lang.t('downloadAll') }}</button>
        }
      </div>
      @if (documents().length) {
        <ul class="files">
          @for (d of documents(); track d.id) {
            <li class="file" [class.file--active]="previewDocId() === d.id">
              <span class="file__name">{{ d.name }}</span>
              <div class="file__actions">
                <button type="button" class="ghost" [class.ghost--active]="previewDocId() === d.id" (click)="togglePreview(d)">
                  {{ previewDocId() === d.id ? (lang.isGerman() ? 'Schließen' : 'Close') : (lang.isGerman() ? 'Vorschau' : 'Preview') }}
                </button>
                <a class="ghost" [href]="downloadUrl(d.id)" [download]="d.name + '.' + d.fileExtension">
                  {{ lang.isGerman() ? 'Herunterladen' : 'Download' }}
                </a>
              </div>
            </li>
          }
        </ul>
      } @else {
        <p class="empty">
          {{ lang.isGerman() ? 'Für diese Version wurde noch kein Dokument hochgeladen.' : 'No document has been uploaded for this version yet.' }}
        </p>
      }

      @if (previewDocId()) {
        <div class="preview">
          <div class="preview__bar">
            <strong>{{ previewName() }}</strong>
            <button type="button" class="ghost" (click)="closePreview()">{{ lang.isGerman() ? 'Schließen' : 'Close' }}</button>
          </div>
          @if (previewError()) {
            <p class="preview__status">{{ previewError() }}</p>
          } @else if (previewUrl()) {
            <iframe class="preview__frame" [src]="previewUrl()"></iframe>
          } @else {
            <p class="preview__status">{{ lang.isGerman() ? 'Wird geladen…' : 'Loading…' }}</p>
          }
        </div>
      }
    </div>
  `
})
export class PdfViewerComponent {
  private readonly http = inject(HttpClient);
  private readonly sanitizer = inject(DomSanitizer);
  readonly lang = inject(LanguageService);
  readonly versionId = input.required<string>();
  readonly canDownloadAll = input(true);

  readonly documents = toSignal(
    toObservable(this.versionId).pipe(switchMap((id) => this.fetchDocuments(id))),
    { initialValue: [] as DocumentRow[] }
  );

  readonly previewDocId = signal<string | null>(null);
  readonly previewName = signal('');
  readonly previewUrl = signal<SafeResourceUrl | null>(null);
  readonly previewError = signal('');
  private previewObjectUrl: string | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.revokePreviewObjectUrl());
  }

  private fetchDocuments(versionId: string) {
    if (!versionId) return of([] as DocumentRow[]);
    // getTotalRecordCountFlag is required — without it the platform silently omits
    // childItems from the response even when the folder has real files (confirmed via the
    // official Document List Page / File Manager API doc, and by live testing: identical
    // request minus this one flag returned an empty list despite a real, nonzero document count).
    return this.http.get<any>(`/networking/solution/ServiceDesk/dmsListPage/${OBJECT_ID.documentVersion}/${versionId}`, {
      params: { getFolderChildCountFlag: true, getPathFlag: true, getTotalRecordCountFlag: true, sortBy: 'name', sortOrder: 'asc' }
    }).pipe(
      map((response): DocumentRow[] =>
        (response?.listData?.folderInfo?.childItems ?? []).map((d: any) => ({
          id: d.id, name: d.name ?? '', fileExtension: d.file_extension ?? ''
        }))),
      catchError((err) => { console.error('Document list fetch failed', err); return of([] as DocumentRow[]); })
    );
  }

  downloadUrl(documentId: string): string {
    return `/networking/rest/dms/${OBJECT_ID.documentVersion}/${this.versionId()}/document/${documentId}/download`;
  }

  togglePreview(d: DocumentRow): void {
    if (this.previewDocId() === d.id) { this.closePreview(); return; }
    this.revokePreviewObjectUrl();
    this.previewDocId.set(d.id);
    this.previewName.set(d.name);
    this.previewUrl.set(null);
    this.previewError.set('');

    this.http.get(this.downloadUrl(d.id), { responseType: 'blob' }).subscribe({
      next: (blob) => {
        // Only the response we asked for last should win, in case the user clicked another row meanwhile.
        if (this.previewDocId() !== d.id) return;
        // The download endpoint sends no Content-Type header, so the blob comes back with an
        // empty MIME type — the browser then shows raw bytes as text instead of rendering a PDF.
        // Force the correct type client-side; every document in this DMS folder is a PDF.
        const pdfBlob = new Blob([blob], { type: 'application/pdf' });
        this.previewObjectUrl = URL.createObjectURL(pdfBlob);
        this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.previewObjectUrl));
      },
      error: (err) => {
        console.error('Document preview fetch failed', err);
        if (this.previewDocId() !== d.id) return;
        this.previewError.set(this.lang.isGerman() ? 'Vorschau fehlgeschlagen.' : 'Preview failed.');
      }
    });
  }

  closePreview(): void {
    this.revokePreviewObjectUrl();
    this.previewDocId.set(null);
    this.previewUrl.set(null);
    this.previewError.set('');
  }

  private revokePreviewObjectUrl(): void {
    if (this.previewObjectUrl) { URL.revokeObjectURL(this.previewObjectUrl); this.previewObjectUrl = null; }
  }

  /** Multiple sequential real downloads — there is no confirmed single "download as zip" endpoint. */
  downloadAll(): void {
    this.documents().forEach((d) => {
      const a = document.createElement('a');
      a.href = this.downloadUrl(d.id);
      a.download = `${d.name}.${d.fileExtension}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }
}
