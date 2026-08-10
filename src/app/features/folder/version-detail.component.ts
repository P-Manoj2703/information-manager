import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { SessionService } from '@core/services/session.service';
import { SERVER_MESSAGE } from '@core/server-messages';
import { API_BASE, DOCUMENT_VERSION_ACTIVATE_MACRO_ID, OBJECT_ID } from '@core/objects';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { VersionStatus } from '@core/models/enums';

interface UploadRow { file: File; state: 'queued' | 'uploading' | 'ok' | 'error'; message?: string; documentId?: string; }

interface VersionRecord {
  id: string;
  document_version_textfield_name: string;
  version_text_field_version_id: string;
  version_picklist_version_status: VersionStatus;
  version_textarea_description: string;
  version_date_time_valid_from: string | null;
  version_date_time_valid_until: string | null;
  version_number_total_document_count: number;
  lastModifiedTimestamp: string;
}

interface DocumentRow { id: string; name: string; fileExtension: string; }

/**
 * Record view for a single document version, reached from the folder's version timeline.
 * Editable (Name / Version ID / Description) only while Draft and only for an Information
 * Provider — matches ECAP's own Default Layout rule ("U-Make field Read Only when status is
 * not draft") exactly: once Active or Inactive, nothing here can be changed from this screen.
 */
@Component({
  selector: 'im-version-detail',
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, StatusBadgeComponent],
  styleUrl: './version-detail.component.scss',
  template: `
    <a class="back" [routerLink]="['/folders', id()]">← {{ folderName() || id() }}</a>

    @if (version(); as v) {
      <section class="card">
        <header class="head">
          <im-status-badge [status]="v.version_picklist_version_status" [dot]="false" />
          <h1>{{ v.document_version_textfield_name }}</h1>
          @if (canEdit() && !editing()) {
            <button type="button" class="ghost" (click)="startEdit(v)">{{ lang.isGerman() ? 'Bearbeiten' : 'Edit' }}</button>
            <button type="button" class="primary" [disabled]="activating()" (click)="activate(v.id)">
              {{ activating() ? (lang.isGerman() ? 'Wird aktiviert…' : 'Activating…') : (lang.isGerman() ? 'Aktivieren' : 'Activate') }}
            </button>
          }
        </header>

        @if (saveError()) { <p class="error">{{ saveError() }}</p> }
        @if (activateError()) { <p class="error">{{ activateError() }}</p> }

        @if (editing()) {
          <form [formGroup]="editForm" (ngSubmit)="saveEdit(v.id)" class="grid">
            <label class="field">
              <span class="label">{{ lang.isGerman() ? 'Name' : 'Name' }}</span>
              <input formControlName="document_version_textfield_name">
            </label>
            <label class="field">
              <span class="label">{{ lang.t('version') }}</span>
              <input formControlName="version_text_field_version_id">
            </label>
            <label class="field wide">
              <span class="label">{{ lang.isGerman() ? 'Beschreibung' : 'Description' }}</span>
              <textarea rows="3" formControlName="version_textarea_description"></textarea>
            </label>
          </form>
          <footer class="edit-actions">
            <button type="button" class="ghost" [disabled]="saving()" (click)="editing.set(false)">{{ lang.isGerman() ? 'Abbrechen' : 'Cancel' }}</button>
            <button type="button" class="primary" [disabled]="editForm.invalid || saving()" (click)="saveEdit(v.id)">
              {{ saving() ? (lang.isGerman() ? 'Wird gespeichert…' : 'Saving…') : (lang.isGerman() ? 'Speichern' : 'Save') }}
            </button>
          </footer>
        } @else {
          <div class="grid">
            <div class="field">
              <span class="label">{{ lang.isGerman() ? 'Informationsordner' : 'Information Folder' }}</span>
              <a [routerLink]="['/folders', id()]">{{ folderName() || id() }}</a>
            </div>
            <div class="field">
              <span class="label">{{ lang.isGerman() ? 'Versionsstatus' : 'Version Status' }}</span>
              <im-status-badge [status]="v.version_picklist_version_status" [dot]="false" />
            </div>
            <div class="field">
              <span class="label">{{ lang.isGerman() ? 'Name' : 'Name' }}</span>
              <span>{{ v.document_version_textfield_name }}</span>
            </div>
            <div class="field">
              <span class="label">{{ lang.t('version') }}</span>
              <span class="mono">{{ v.version_text_field_version_id }}</span>
            </div>
            <div class="field wide">
              <span class="label">{{ lang.isGerman() ? 'Beschreibung' : 'Description' }}</span>
              <span>{{ v.version_textarea_description || '—' }}</span>
            </div>
            <div class="field">
              <span class="label">{{ lang.isGerman() ? 'Gültig von' : 'Valid from' }}</span>
              <span>{{ v.version_date_time_valid_from ? lang.date(v.version_date_time_valid_from) : '—' }}</span>
            </div>
            <div class="field">
              <span class="label">{{ lang.isGerman() ? 'Gültig bis' : 'Valid until' }}</span>
              <span>{{ v.version_date_time_valid_until ? lang.date(v.version_date_time_valid_until) : '—' }}</span>
            </div>
            <div class="field">
              <span class="label">{{ lang.isGerman() ? 'Dokumente gesamt' : 'Total documents' }}</span>
              <span>{{ v.version_number_total_document_count }}</span>
            </div>
          </div>
        }

        <div class="documents">
          <span class="label">{{ lang.isGerman() ? 'Dokument' : 'Document' }}</span>
          @if (documentsLoading()) {
            <p class="missing">{{ lang.isGerman() ? 'Wird geladen…' : 'Loading…' }}</p>
          } @else {
            <ul class="files">
              @for (d of documents(); track d.id) {
                <li>
                  <span class="kind">{{ d.fileExtension.toUpperCase() }}</span>
                  <span class="meta"><strong>{{ d.name }}</strong></span>
                  <a class="ghost" [href]="downloadUrl(d.id)" target="_blank" rel="noopener">{{ lang.isGerman() ? 'Öffnen' : 'Open' }}</a>
                </li>
              } @empty {
                @if (v.version_number_total_document_count > 0) {
                  <p class="missing">
                    {{ lang.isGerman()
                      ? v.version_number_total_document_count + ' Dokument(e) laut ECAP — Liste momentan nicht abrufbar.'
                      : v.version_number_total_document_count + ' document(s) per ECAP — list unavailable right now.' }}
                  </p>
                } @else {
                  <p class="missing">{{ lang.isGerman() ? 'Keine Dokumente hinterlegt.' : 'No documents on file.' }}</p>
                }
              }
            </ul>
          }
        </div>

        @if (canEdit()) {
          <div class="documents">
            <span class="label">{{ lang.isGerman() ? 'Dokument hinzufügen' : 'Add document' }}</span>
            <div class="drop" (dragover)="$event.preventDefault()" (drop)="onDrop($event)">
              <strong>{{ lang.isGerman() ? 'PDF hierher ziehen' : 'Drag your PDF here' }}</strong>
              <span>{{ lang.isGerman() ? 'Nur PDF. Andere Formate werden vom Server abgelehnt.' : 'PDF only. Other formats are rejected by the server.' }}</span>
              <input #picker type="file" accept="application/pdf" multiple hidden (change)="onPick($event)">
              <button type="button" class="ghost" (click)="picker.click()">{{ lang.isGerman() ? 'Datei wählen' : 'Choose file' }}</button>
            </div>

            @if (uploadRows().length) {
              <ul class="files">
                @for (r of uploadRows(); track r.file.name) {
                  <li [class.error]="r.state === 'error'">
                    <span class="kind">PDF</span>
                    <span class="meta">
                      <strong>{{ r.file.name }}</strong>
                      <small>{{ uploadRowStatus(r) }}</small>
                    </span>
                    @if (r.state !== 'uploading') {
                      <button type="button" class="x" (click)="removeUploadRow(r)" aria-label="remove">×</button>
                    }
                  </li>
                }
              </ul>
            }
          </div>
        }
      </section>
    } @else if (!loading()) {
      <p class="missing">{{ lang.isGerman() ? 'Version nicht gefunden.' : 'Version not found.' }}</p>
    }
  `
})
export class VersionDetailComponent {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);
  readonly session = inject(SessionService);
  readonly lang = inject(LanguageService);

  readonly id = input.required<string>();
  readonly versionId = input.required<string>();

  readonly loading = signal(true);
  readonly documentsLoading = signal(true);
  private readonly refresh = signal(0);

  readonly version = toSignal(
    combineLatest([toObservable(this.versionId), toObservable(this.refresh)]).pipe(
      switchMap(([versionId]) => this.fetchVersion(versionId)),
      map((v) => { this.loading.set(false); return v; })
    ),
    { initialValue: null as VersionRecord | null }
  );

  /** Matches ECAP's own Default Layout rule: editable only while Draft, and only for the Information Provider role. */
  readonly canEdit = computed(() => this.session.canCreateFolder() && this.version()?.version_picklist_version_status === 'Draft');

  readonly activating = signal(false);
  readonly activateError = signal('');

  /** Same real macro endpoint confirmed for the "Activate and notify" dialog — direct here since Edit is equally direct on this screen. */
  activate(versionId: string): void {
    if (this.activating()) return;
    this.activating.set(true);
    this.activateError.set('');
    this.http.post<any>(
      `${API_BASE}/record/${OBJECT_ID.documentVersion}/${versionId}/execMacro/${DOCUMENT_VERSION_ACTIVATE_MACRO_ID}`, {}
    ).subscribe({
      next: () => {
        this.activating.set(false);
        this.loading.set(true);
        this.refresh.update((n) => n + 1);
      },
      error: (err) => {
        console.error('Activate Document Version failed', err);
        this.activating.set(false);
        // execMacro errors nest the real message under platform.message.description, not __exception_msg__.
        this.activateError.set(err?.error?.platform?.message?.description ?? (this.lang.isGerman() ? 'Aktivierung fehlgeschlagen.' : 'Activation failed.'));
      }
    });
  }

  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly saveError = signal('');
  readonly editForm = this.fb.nonNullable.group({
    document_version_textfield_name: ['', Validators.required],
    version_text_field_version_id: ['', Validators.required],
    version_textarea_description: ['']
  });

  startEdit(v: VersionRecord): void {
    this.editForm.setValue({
      document_version_textfield_name: v.document_version_textfield_name,
      version_text_field_version_id: v.version_text_field_version_id,
      version_textarea_description: v.version_textarea_description
    });
    this.saveError.set('');
    this.editing.set(true);
  }

  saveEdit(versionId: string): void {
    if (this.editForm.invalid || this.saving()) return;
    this.saving.set(true);
    this.saveError.set('');
    this.http.put<any>(`/networking/solution/ServiceDesk/record/${OBJECT_ID.documentVersion}/${versionId}`, {
      ...this.editForm.getRawValue(),
      last_modified_timestamp: this.version()?.lastModifiedTimestamp ?? ''
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.editing.set(false);
        this.loading.set(true);
        this.refresh.update((n) => n + 1);
      },
      error: (err) => {
        console.error('Document version update failed', err);
        this.saving.set(false);
        this.saveError.set(err?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Speichern fehlgeschlagen.' : 'Save failed.'));
      }
    });
  }

  readonly folderName = toSignal(
    toObservable(this.id).pipe(switchMap((folderId) => this.fetchFolderName(folderId))),
    { initialValue: '' }
  );

  readonly documents = toSignal(
    toObservable(this.versionId).pipe(
      switchMap((versionId) => this.fetchDocuments(versionId)),
      map((docs) => { this.documentsLoading.set(false); return docs; })
    ),
    { initialValue: [] as DocumentRow[] }
  );

  private fetchVersion(versionId: string): Observable<VersionRecord | null> {
    if (!versionId) return of(null);
    return this.http.get<any>(`/networking/rest/record/${OBJECT_ID.documentVersion}/${versionId}`, {
      params: { alt: 'json' }
    }).pipe(
      map((response): VersionRecord | null => {
        const r = response?.platform?.record;
        if (!r) return null;
        return {
          id: r.id,
          document_version_textfield_name: r.document_version_textfield_name ?? '',
          version_text_field_version_id: r.version_text_field_version_id ?? '',
          // Picklist fields come back as {displayValue, content} objects from this endpoint, not plain strings.
          version_picklist_version_status: r.version_picklist_version_status?.content ?? 'Draft',
          version_textarea_description: r.version_textarea_description ?? '',
          version_date_time_valid_from: r.version_date_time_valid_from || null,
          version_date_time_valid_until: r.version_date_time_valid_until || null,
          version_number_total_document_count: Number(r.version_number_total_document_count || 0),
          lastModifiedTimestamp: r.date_modified ?? ''
        };
      }),
      catchError((err) => { console.error('Document version fetch failed', err); return of(null); })
    );
  }

  private fetchFolderName(folderId: string): Observable<string> {
    if (!folderId) return of('');
    return this.http.get<any>(`/networking/rest/record/${OBJECT_ID.informationFolder}/${folderId}`, {
      params: { fieldList: 'information_folder_textfield_name', alt: 'json' }
    }).pipe(
      map((response) => response?.platform?.record?.information_folder_textfield_name ?? ''),
      catchError((err) => { console.error('Folder name fetch failed', err); return of(''); })
    );
  }

  /**
   * getTotalRecordCountFlag is required — without it the platform silently omits childItems
   * from the response even when the folder has real files (confirmed via the official
   * Document List Page / File Manager API doc, and by live testing: the identical request
   * minus this one flag returned an empty list despite version_number_total_document_count
   * being nonzero on the record itself).
   */
  private fetchDocuments(versionId: string): Observable<DocumentRow[]> {
    if (!versionId) return of([]);
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

  /** The record's DMS "Root Folder" id (recordFolderTree), required by the finalize upload call — same 2-step flow confirmed for creation. */
  private readonly rootFolderId = toSignal(
    toObservable(this.versionId).pipe(switchMap((versionId) => this.fetchRootFolderId(versionId))),
    { initialValue: null as string | null }
  );

  readonly uploadRows = signal<UploadRow[]>([]);

  uploadRowStatus(r: UploadRow): string {
    if (r.message) return r.message;
    if (r.state === 'queued' || r.state === 'uploading') return this.lang.isGerman() ? 'Wird hochgeladen…' : 'Uploading…';
    return `${(r.file.size / 1_048_576).toFixed(1)} MB`;
  }

  onDrop(e: DragEvent): void { e.preventDefault(); this.addUpload(Array.from(e.dataTransfer?.files ?? [])); }
  onPick(e: Event): void { this.addUpload(Array.from((e.target as HTMLInputElement).files ?? [])); }

  private addUpload(files: File[]): void {
    files.forEach((file) => {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        this.uploadRows.update((r) => [...r, { file, state: 'error', message: SERVER_MESSAGE.nonPdf(file.name) }]);
        return;
      }
      this.uploadRows.update((r) => [...r, { file, state: 'uploading' }]);
      this.startUpload(file);
    });
  }

  removeUploadRow(row: UploadRow): void {
    this.uploadRows.update((rows) => rows.filter((r) => r.file !== row.file));
  }

  private startUpload(file: File, attempt = 0): void {
    const versionId = this.versionId();
    const folderId = this.rootFolderId();
    if (!folderId) {
      // Root folder lookup (fired alongside the version fetch) usually resolves almost
      // immediately — retry briefly rather than leaving the row stuck in 'uploading', but
      // give up and surface a real error if it never does (e.g. the lookup itself failed).
      if (attempt < 10) { setTimeout(() => this.startUpload(file, attempt + 1), 400); return; }
      this.uploadRows.update((rows) => rows.map((r) => r.file === file
        ? { ...r, state: 'error', message: this.lang.isGerman() ? 'Hochladen fehlgeschlagen.' : 'Upload failed.' }
        : r));
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    this.http.post<any>('/networking/solution/ServiceDesk/uploadfile/dmsDocument', formData).pipe(
      switchMap((uploadResponse) => {
        const parsed = JSON.parse(uploadResponse?.__success_msg__ ?? '[]')[0];
        if (!parsed?.valid) throw new Error(parsed?.message || 'Upload failed');
        return this.http.post<any>(
          `/networking/solution/ServiceDesk/dmsDocument/${OBJECT_ID.documentVersion}/${versionId}`,
          {
            name: file.name.replace(/\.pdf$/i, ''),
            description: '', document_type: '', document_type_name: '',
            folder_id: folderId, test: null, _documentTags: ''
          },
          { params: { id: '-1', __file_path: parsed.file_path } }
        );
      })
    ).subscribe({
      next: (finalizeResponse) => {
        const documentId = String(finalizeResponse?.record?.id ?? '');
        this.uploadRows.update((rows) => rows.map((r) => r.file === file ? { ...r, state: 'ok', documentId } : r));
        this.refresh.update((n) => n + 1);
      },
      error: (err) => {
        console.error('Document upload failed', err);
        this.uploadRows.update((rows) => rows.map((r) => r.file === file
          ? { ...r, state: 'error', message: err?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Hochladen fehlgeschlagen.' : 'Upload failed.') }
          : r));
      }
    });
  }

  private fetchRootFolderId(versionId: string): Observable<string | null> {
    if (!versionId) return of(null);
    return this.http.get<any>(`/networking/solution/ServiceDesk/recordFolderTree/${OBJECT_ID.documentVersion}/${versionId}`, {
      params: { docCount: true }
    }).pipe(
      map((r) => r?.recordFolderTree?.folderId ?? null),
      catchError((err) => { console.error('Root folder lookup failed', err); return of(null); })
    );
  }
}
