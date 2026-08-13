import { Component, EventEmitter, Output, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RecordCreateDirective } from '@escriba/cui-ecap-runtime';
import { catchError, map, of, switchMap } from 'rxjs';
import { SessionService } from '@core/services/session.service';
import { LanguageService } from '@core/i18n/language.service';
import { SERVER_MESSAGE } from '@core/server-messages';
import { API_BASE, DOCUMENT_VERSION_LAYOUT_ID, INFORMATION_FOLDER_ACTIVATE_MACRO_ID, OBJECT_ID } from '@core/objects';

interface Row {
  file: File;
  state: 'queued' | 'uploading' | 'ok' | 'error';
  message?: string;
  /** The real DMS document id, set once the finalize call succeeds — needed to delete it from ECAP. */
  documentId?: string;
  deleting?: boolean;
  /** Real client-side timestamp captured the moment the finalize call actually succeeds — this object has no server-returned upload date to read instead. */
  uploadedAt?: Date;
}

/**
 * UC-IP-03. Fields and the PDF drop zone are on one screen and one "Save" click —
 * files picked before the record exists are held as 'queued' and uploaded the
 * moment the record (and its DMS folder) become available, so from the user's
 * point of view the record and its document are saved together. Underneath,
 * ECAP still requires the record to exist before its DMS folder does, so the
 * real sequence is unavoidably: create record -> look up its Root Folder id ->
 * upload each queued file. Upload itself is two calls, confirmed live via
 * network capture of the native "Upload Document" dialog:
 *  1. POST multipart to uploadfile/dmsDocument (field name "file") — returns a
 *     temp file_path token wrapped in a legacy __success_msg__ JSON string.
 *  2. POST metadata (name, folder_id, …) to dmsDocument/{oid}/{rid} with that
 *     file_path as a query param — this is what actually attaches the file to
 *     the record's DMS folder and is what triggers the server-side
 *     Total Document Count increment (VersionUtil.incrementDocumentCount).
 */
@Component({
  selector: 'im-version-upload',
  standalone: true,
  imports: [ReactiveFormsModule, RecordCreateDirective],
  styleUrl: './version-upload.component.scss',
  template: `
    <section class="card">
      <h2><span class="step-num">3</span> · {{ lang.isGerman() ? 'Dokumentversion' : 'Document version' }}</h2>
      <p class="subtitle">{{ lang.isGerman()
        ? 'Nur PDF. Die Version bleibt im Entwurf, bis Sie sie aktivieren.'
        : 'PDF only. The version stays in Draft until you activate it.' }}</p>

      @if (createError()) { <p class="error">{{ createError() }}</p> }

      @if (createPayload()) {
        <ng-container
          [libEcapRuntimeRecordCreate]="createPayload()"
          [objectId]="OBJECT_ID.documentVersion"
          (apiResponseEvent)="onCreateResponse($event)"
          (apiErrorEvent)="onCreateError($event)">
        </ng-container>
      }

      <form [formGroup]="form" class="grid">
        <label>{{ lang.isGerman() ? 'Informationsordner' : 'Information Folder' }} *
          <input [value]="folderName()" disabled>
        </label>
        <label>{{ lang.isGerman() ? 'Versionsstatus' : 'Version Status' }}
          <input value="Draft" disabled>
        </label>
        <label>{{ lang.isGerman() ? 'Name' : 'Name' }} *
          <input formControlName="document_version_textfield_name">
        </label>
        <label>{{ lang.t('version') }} *
          <input formControlName="version_text_field_version_id" placeholder="v1.0">
        </label>
        <label class="wide">{{ lang.isGerman() ? 'Beschreibung' : 'Description' }}
          <textarea rows="3" formControlName="version_textarea_description"></textarea>
        </label>
      </form>

      @if (!session.canUploadFiles()) {
        <p class="denied">{{ serverMessages.recipientForbidden }}</p>
      } @else {
        <div class="drop" (dragover)="$event.preventDefault()" (drop)="onDrop($event)">
          <strong>{{ lang.isGerman() ? 'PDF hierher ziehen' : 'Drag your PDF here' }}</strong>
          <span>{{ lang.t('pdfOnly') }}</span>
          <input #picker type="file" accept="application/pdf" multiple hidden (change)="onPick($event)">
          <button type="button" class="ghost" (click)="picker.click()">
            {{ lang.isGerman() ? 'Datei wählen' : 'Choose file' }}
          </button>
        </div>

        <ul class="files">
          @for (r of rows(); track r.file.name) {
            <li [class.error]="r.state === 'error'">
              <span class="kind">{{ ext(r.file.name) }}</span>
              <span class="meta">
                <strong>{{ r.file.name }}</strong>
                <small [class.msg]="r.state === 'error'">{{ rowStatus(r) }}</small>
              </span>
              <span class="pill" [class.pill--error]="r.state === 'error'" [class.pill--pending]="r.state === 'queued' || r.state === 'uploading'">
                {{ pillLabel(r) }}
              </span>
              @if (r.state !== 'uploading') {
                <button type="button" class="x" [disabled]="r.deleting" (click)="removeFile(r)" aria-label="remove">×</button>
              }
            </li>
          }
        </ul>

        @if (deleteError()) { <p class="error">{{ deleteError() }}</p> }

        <p class="count">
          {{ lang.isGerman() ? 'Dokumente gesamt (automatisch)' : 'Total documents (maintained automatically)' }}
          <b>{{ okCount() }}</b>
        </p>
      }

      @if (folderActivateError()) { <p class="error">{{ folderActivateError() }}</p> }
      @if (folderActivating()) {
        <p class="count">{{ lang.isGerman() ? 'Informationsordner wird aktiviert…' : 'Activating information folder…' }}</p>
      }
      @if (folderActivated()) {
        <p class="count">{{ lang.isGerman() ? 'Informationsordner ist jetzt aktiv.' : 'Information folder is now active.' }}</p>
      }

      <footer>
        <span class="spacer"></span>
        <button type="button" class="ghost" (click)="back.emit()">{{ lang.isGerman() ? 'Zurück' : 'Back' }}</button>
        @if (!versionRecordId()) {
          <button class="primary" [disabled]="form.invalid || creating()" (click)="save()">
            {{ creating()
              ? (lang.isGerman() ? 'Wird gespeichert…' : 'Saving…')
              : (lang.isGerman() ? 'Speichern' : 'Save') }}
          </button>
        } @else {
          <button class="primary" (click)="continue.emit(versionRecordId() ?? '')">{{ lang.isGerman() ? 'Weiter zur Veröffentlichung' : 'Continue to publish' }}</button>
        }
      </footer>
    </section>
  `
})
export class VersionUploadComponent {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);
  readonly session = inject(SessionService);
  readonly lang = inject(LanguageService);
  readonly serverMessages = SERVER_MESSAGE;
  readonly OBJECT_ID = OBJECT_ID;

  readonly folderId = input<string>('');
  readonly folderName = input<string>('');
  /** Emits the newly-created Document Version record id, so the next step can act on it. */
  @Output() readonly continue = new EventEmitter<string>();
  /** Navigates back to the Audience step — this component holds no step-routing logic of its own. */
  @Output() readonly back = new EventEmitter<void>();

  readonly form = this.fb.nonNullable.group({
    document_version_textfield_name: ['', Validators.required],
    version_text_field_version_id: ['', Validators.required],
    version_textarea_description: ['']
  });

  readonly creating = signal(false);
  readonly createError = signal('');
  readonly createPayload = signal<Record<string, unknown> | null>(null);
  /** Set once the real Document Version record exists. */
  readonly versionRecordId = signal<string | null>(null);
  /** The record's own DMS "Root Folder" id (recordFolderTree), required by the finalize upload call. */
  readonly rootFolderId = signal<string | null>(null);

  readonly folderActivating = signal(false);
  readonly folderActivated = signal(false);
  readonly folderActivateError = signal('');

  readonly rows = signal<Row[]>([]);
  readonly deleteError = signal('');
  okCount = () => this.rows().filter((r) => r.state === 'ok').length;

  rowStatus(r: Row): string {
    if (r.deleting) return this.lang.isGerman() ? 'Wird gelöscht…' : 'Deleting…';
    if (r.message) return r.message;
    switch (r.state) {
      case 'queued': return this.lang.isGerman() ? 'Wird nach dem Speichern hochgeladen' : 'Will upload once saved';
      case 'uploading': return this.lang.isGerman() ? 'Wird hochgeladen…' : 'Uploading…';
      default: return r.uploadedAt ? `${this.size(r.file)} · ${this.uploadedAtLabel(r.uploadedAt)}` : this.size(r.file);
    }
  }

  private uploadedAtLabel(d: Date): string {
    const time = d.toLocaleTimeString(this.lang.isGerman() ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
    return this.lang.isGerman() ? `Hochgeladen um ${time}` : `Uploaded at ${time}`;
  }

  pillLabel(r: Row): string {
    switch (r.state) {
      case 'ok': return this.lang.isGerman() ? 'Hochgeladen' : 'Uploaded';
      case 'error': return this.lang.isGerman() ? 'Abgelehnt' : 'Rejected';
      case 'uploading': return this.lang.isGerman() ? 'Wird hochgeladen' : 'Uploading';
      default: return this.lang.isGerman() ? 'Warteschlange' : 'Queued';
    }
  }

  save(): void {
    if (this.form.invalid || this.creating()) return;
    this.creating.set(true);
    this.createError.set('');
    this.createPayload.set({
      ...this.form.getRawValue(),
      informationfolder_record: this.folderId(),
      // Must be explicit, not omitted: the "Status cannot be changed if Document master
      // is not active" validation runs on Add too and checks version_picklist_version_status
      // != 'Draft' before the platform's own default-to-Draft applies — an unset field
      // reads as blank (!= 'Draft'), which combined with a Draft folder trips a false
      // positive on every first Document Version create. Confirmed via the real
      // validation_criteria pulled from ECAP.
      version_picklist_version_status: 'Draft',
      layout_id: DOCUMENT_VERSION_LAYOUT_ID,
      _request_id: crypto.randomUUID(),
      _gridSectionsRecords_: {},
      last_modified_timestamp: ''
    });
  }

  onCreateResponse(response: any): void {
    this.creating.set(false);
    this.createPayload.set(null);
    const id = String(response?.record?.id ?? response?.id ?? '');
    this.versionRecordId.set(id);
    // Name/Version ID/Description stay editable while Draft in ECAP's own Default Layout rules,
    // but re-saving them isn't part of this flow yet — lock them once the record exists.
    this.form.disable();

    this.http.get<any>(`/networking/solution/ServiceDesk/recordFolderTree/${OBJECT_ID.documentVersion}/${id}`, {
      params: { docCount: true }
    }).pipe(
      map((r) => r?.recordFolderTree?.folderId ?? ''),
      catchError((err) => { console.error('Document version root folder lookup failed', err); return of(''); })
    ).subscribe((folderId) => {
      this.rootFolderId.set(folderId);
      // Anything dropped in while the record was still being created uploads now.
      this.rows().filter((r) => r.state === 'queued').forEach((r) => this.startUpload(r.file));
      this.maybeActivateFolder();
    });
  }

  /**
   * Requested behaviour: the moment the Document Version's data (and any attached
   * document) finish saving, the Information Folder itself goes Active — no separate
   * confirmation click. Fires once every queued/uploading row has settled (including
   * immediately, if no file was attached at all) — but never while any row is in
   * 'error', since a failed upload means the document was NOT actually saved and the
   * user needs to see and fix that before the folder goes live. Reuses the same real
   * execMacro endpoint the folder list's own Activate button now uses.
   */
  private maybeActivateFolder(): void {
    if (this.folderActivated() || this.folderActivating()) return;
    if (this.rows().some((r) => r.state === 'queued' || r.state === 'uploading' || r.state === 'error')) return;

    this.folderActivating.set(true);
    this.folderActivateError.set('');
    this.http.post<any>(
      `${API_BASE}/record/${OBJECT_ID.informationFolder}/${this.folderId()}/execMacro/${INFORMATION_FOLDER_ACTIVATE_MACRO_ID}`, { params: {} }
    ).subscribe({
      next: () => { this.folderActivating.set(false); this.folderActivated.set(true); },
      error: (err) => {
        console.error('Information folder activation failed', err);
        this.folderActivating.set(false);
        // execMacro errors nest the real message under platform.message.description, not __exception_msg__.
        this.folderActivateError.set(err?.error?.platform?.message?.description ?? (this.lang.isGerman() ? 'Aktivierung fehlgeschlagen.' : 'Activation failed.'));
      }
    });
  }

  onCreateError(error: HttpErrorResponse): void {
    this.creating.set(false);
    this.createPayload.set(null);
    this.createError.set(error.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Speichern fehlgeschlagen.' : 'Save failed.'));
  }

  onDrop(e: DragEvent): void { e.preventDefault(); this.add(Array.from(e.dataTransfer?.files ?? [])); }
  onPick(e: Event): void { this.add(Array.from((e.target as HTMLInputElement).files ?? [])); }

  private add(files: File[]): void {
    files.forEach((file) => {
      // Client-side guard mirrors VersionUtil.validateDocumentOperation's extension check; the
      // server remains authoritative and its message is shown verbatim on a real rejection.
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        this.rows.update((r) => [...r, { file, state: 'error', message: SERVER_MESSAGE.nonPdf(file.name) }]);
        return;
      }
      // Record (and its DMS folder) may not exist yet — queue until save() creates it.
      this.rows.update((r) => [...r, { file, state: 'queued' }]);
      if (this.versionRecordId() && this.rootFolderId()) this.startUpload(file);
    });
  }

  private startUpload(file: File): void {
    this.rows.update((rows) => rows.map((r) => r.file === file ? { ...r, state: 'uploading' } : r));

    const versionId = this.versionRecordId();
    const folderId = this.rootFolderId();
    if (!versionId || !folderId) return;

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
            description: '',
            document_type: '',
            document_type_name: '',
            folder_id: folderId,
            test: null,
            _documentTags: ''
          },
          { params: { id: '-1', __file_path: parsed.file_path } }
        );
      })
    ).subscribe({
      next: (finalizeResponse) => {
        const documentId = String(finalizeResponse?.record?.id ?? '');
        this.rows.update((rows) => rows.map((r) => r.file === file ? { ...r, state: 'ok', documentId, uploadedAt: new Date() } : r));
        this.maybeActivateFolder();
      },
      error: (err) => {
        console.error('Document upload failed', err);
        // Deliberately does not call maybeActivateFolder(): a failed upload means the
        // document was not actually saved, so the folder must not go live until the
        // user sees this error and either fixes it or removes the offending file.
        this.rows.update((rows) => rows.map((r) => r.file === file
          ? { ...r, state: 'error', message: err?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Hochladen fehlgeschlagen.' : 'Upload failed.') }
          : r));
      }
    });
  }

  /**
   * A 'queued' or 'error' row was never actually persisted in ECAP — dropping it locally is
   * enough, and also unblocks maybeActivateFolder() if it was the last thing in its way.
   * An 'ok' row IS a real document already attached in ECAP's DMS, so removing it here must
   * delete it there too — the local list must never drift out of sync with what ECAP has.
   */
  removeFile(row: Row): void {
    if (row.state !== 'ok') {
      this.rows.update((rows) => rows.filter((r) => r.file !== row.file));
      this.maybeActivateFolder();
      return;
    }

    const versionId = this.versionRecordId();
    if (!row.documentId || !versionId) return;

    this.deleteError.set('');
    this.rows.update((rows) => rows.map((r) => r.file === row.file ? { ...r, deleting: true } : r));

    // Real ECAP delete, confirmed live via network capture of the native File Manager's
    // delete button: a mass-operation validate-then-delete pair, both DELETE with the same
    // {docIds, folderIds} body — docIds a single (or comma-joined) id string, not an array.
    const base = `/networking/solution/ServiceDesk/dmsMassOperation/${OBJECT_ID.documentVersion}/${versionId}/delete`;
    const body = { docIds: row.documentId, folderIds: '' };
    this.http.delete<any>(`${base}/validate`, { body }).pipe(
      switchMap(() => this.http.delete<any>(base, { body }))
    ).subscribe({
      next: () => this.rows.update((rows) => rows.filter((r) => r.file !== row.file)),
      error: (err) => {
        console.error('Document delete failed', err);
        this.rows.update((rows) => rows.map((r) => r.file === row.file ? { ...r, deleting: false } : r));
        this.deleteError.set(err?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Löschen fehlgeschlagen.' : 'Delete failed.'));
      }
    });
  }

  ext = (n: string) => n.split('.').pop()?.toUpperCase() ?? '';
  size = (f: File) => `${(f.size / 1_048_576).toFixed(1)} MB`;
}
