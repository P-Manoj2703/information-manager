import { Component, DestroyRef, effect, inject, input, model, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { OBJECT_ID } from '@core/objects';

export interface DocumentRow { id: string; name: string; fileExtension: string }

export function documentDownloadUrl(versionId: string, documentId: string): string {
  return `/networking/rest/dms/${OBJECT_ID.documentVersion}/${versionId}/document/${documentId}/download`;
}

/**
 * Real document list for the acknowledgement's linked Document Version, via the same
 * dmsListPage endpoint proven for Document Version's own "Add document" panel
 * (version-detail.component.ts). The real download endpoint always answers with
 * Content-Disposition: attachment (confirmed live) — a plain <a href> or <iframe src>
 * against it always forces a download, never an inline view. To let the recipient actually
 * read the document in place, previewing fetches the same bytes as a blob via HttpClient
 * (Content-Disposition only governs browser-native navigation, not XHR/fetch) and renders
 * that blob in an iframe; the download icon/button keeps using the real endpoint directly.
 */
@Component({
  selector: 'im-pdf-viewer',
  standalone: true,
  styles: [`
    :host { display: block; }
    .frame { background: #fff; border: 1px solid var(--border-1); border-radius: var(--radius-card); overflow: hidden; }
    .bar { display: flex; align-items: center; gap: 10px; padding: 14px 20px; border-bottom: 1px solid var(--border-1); }
    .bar strong { font-size: 14px; flex: 0 0 auto; }
    .bar .doc-pill {
      background: var(--bg-mint); color: var(--escriba-teal-700); font-size: 13px; font-weight: 600;
      padding: 4px 12px; border-radius: var(--radius-pill); flex: 0 1 auto; max-width: 100%; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .bar .spacer { margin-left: auto; }
    .ghost {
      border: 1px solid var(--border-2); background: #fff; color: var(--fg-2); cursor: pointer; text-decoration: none;
      font: inherit; font-size: 13px; font-weight: 600; padding: 7px 14px; border-radius: var(--radius-pill);
      white-space: nowrap;
    }
    .empty { padding: 32px; text-align: center; color: var(--fg-3); font-size: 13px; }
    .preview__frame { width: 100%; height: 70vh; border: 0; display: block; }
    .preview__status { padding: 32px; text-align: center; color: var(--fg-3); font-size: 13px; }
  `],
  template: `
    <div class="frame">
      <div class="bar">
        <strong>{{ lang.isGerman() ? 'Dokument' : 'Document' }}</strong>
        @if (previewName()) {
          <span class="doc-pill">{{ previewName() }}</span>
        }
        <span class="spacer"></span>
        @if (canDownloadAll() && documents().length > 0) {
          <button type="button" class="ghost" (click)="downloadAll()">{{ lang.t('downloadAll') }}</button>
        }
      </div>

      @if (documentsLoading()) {
        <p class="empty">{{ lang.isGerman() ? 'Wird geladen…' : 'Loading…' }}</p>
      } @else if (!documents().length) {
        <p class="empty">
          {{ lang.isGerman() ? 'Für diese Version wurde noch kein Dokument hochgeladen.' : 'No document has been uploaded for this version yet.' }}
        </p>
      } @else if (previewError()) {
        <p class="preview__status">{{ previewError() }}</p>
      } @else if (previewUrl()) {
        <iframe class="preview__frame" [src]="previewUrl()"></iframe>
      } @else {
        <p class="preview__status">{{ lang.isGerman() ? 'Wird geladen…' : 'Loading…' }}</p>
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

  readonly documentsLoading = signal(true);
  readonly documents = toSignal(
    toObservable(this.versionId).pipe(
      switchMap((id) => this.fetchDocuments(id)),
      map((docs) => { this.documentsLoading.set(false); return docs; })
    ),
    { initialValue: [] as DocumentRow[] }
  );

  /** So a sidebar elsewhere on the page (e.g. a document-count panel) can list/select without duplicating this fetch. */
  readonly documentsChange = output<DocumentRow[]>();

  /** Two-way — lets a picker outside this component drive which document is shown. */
  readonly previewDocId = model<string | null>(null);
  readonly previewName = signal('');
  readonly previewUrl = signal<SafeResourceUrl | null>(null);
  readonly previewError = signal('');
  private previewObjectUrl: string | null = null;
  private loadedDocId: string | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.revokePreviewObjectUrl());

    // A folder can have several documents — recipients shouldn't have to click one just to
    // read the first, so whichever loads first opens automatically.
    effect(() => {
      const docs = this.documents();
      this.documentsChange.emit(docs);
      if (docs.length && !this.previewDocId()) this.previewDocId.set(docs[0].id);
    }, { allowSignalWrites: true });

    // Reacts to previewDocId changing from ANY source — not just a click inside this
    // component, but also an external picker (e.g. a sidebar elsewhere on the page) driving
    // the same two-way-bound signal. Without this, setting the model from outside moved the
    // selection highlight there but never actually fetched/rendered that document's PDF.
    effect(() => {
      const id = this.previewDocId();
      const doc = this.documents().find((d) => d.id === id);
      if (doc) this.loadPreview(doc);
    }, { allowSignalWrites: true });
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
    return documentDownloadUrl(this.versionId(), documentId);
  }

  /** Fetches and renders one document's PDF — skips if it's already the one currently shown. */
  private loadPreview(d: DocumentRow): void {
    if (this.loadedDocId === d.id) return;
    this.loadedDocId = d.id;
    this.revokePreviewObjectUrl();
    this.previewName.set(d.name);
    this.previewUrl.set(null);
    this.previewError.set('');

    this.http.get(this.downloadUrl(d.id), { responseType: 'blob' }).subscribe({
      next: (blob) => {
        // Only the response we asked for last should win, in case the selection changed meanwhile.
        if (this.loadedDocId !== d.id) return;
        // The download endpoint sends no Content-Type header, so the blob comes back with an
        // empty MIME type — the browser then shows raw bytes as text instead of rendering a PDF.
        // Force the correct type client-side; every document in this DMS folder is a PDF.
        const pdfBlob = new Blob([blob], { type: 'application/pdf' });
        this.previewObjectUrl = URL.createObjectURL(pdfBlob);
        this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.previewObjectUrl));
      },
      error: (err) => {
        console.error('Document preview fetch failed', err);
        if (this.loadedDocId !== d.id) return;
        this.previewError.set(this.lang.isGerman() ? 'Vorschau fehlgeschlagen.' : 'Preview failed.');
      }
    });
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
