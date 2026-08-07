import { Component, EventEmitter, Output, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataPort } from '@core/services/data.port';
import { SessionService } from '@core/services/session.service';
import { LanguageService } from '@core/i18n/language.service';
import { SERVER_MESSAGE } from '@core/server-messages';

interface Row { file: File; state: 'uploading' | 'ok' | 'error'; message?: string; }

/**
 * UC-IP-03. PDF-only is stated BEFORE the picker; a rejected file keeps its own
 * row with the verbatim server message while the others continue uploading.
 */
@Component({
  selector: 'im-version-upload',
  standalone: true,
  imports: [ReactiveFormsModule],
  styleUrl: './version-upload.component.scss',
  template: `
    <section class="card">
      <h2>{{ lang.isGerman() ? 'Dokumentversion' : 'Document version' }}</h2>

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
          <button type="button" class="ghost" (click)="picker.click()">{{ lang.isGerman() ? 'Datei wählen' : 'Choose file' }}</button>
        </div>

        <ul class="files">
          @for (r of rows(); track r.file.name) {
            <li [class.error]="r.state === 'error'">
              <span class="kind">{{ ext(r.file.name) }}</span>
              <span class="meta">
                <strong>{{ r.file.name }}</strong>
                <small [class.msg]="r.state === 'error'">{{ r.message ?? size(r.file) }}</small>
              </span>
            </li>
          }
        </ul>

        <p class="count">
          {{ lang.isGerman() ? 'Dokumente gesamt (automatisch)' : 'Total documents (maintained automatically)' }}:
          <b>{{ okCount() }}</b>
        </p>
      }

      <footer><button class="primary" [disabled]="form.invalid" (click)="continue.emit()">{{ lang.isGerman() ? 'Weiter' : 'Continue' }}</button></footer>
    </section>
  `
})
export class VersionUploadComponent {
  private readonly data = inject(DataPort);
  private readonly fb = inject(FormBuilder);
  readonly session = inject(SessionService);
  readonly lang = inject(LanguageService);
  readonly serverMessages = SERVER_MESSAGE;

  readonly folderId = input<string>('');
  readonly folderName = input<string>('');
  @Output() readonly continue = new EventEmitter<void>();

  readonly form = this.fb.nonNullable.group({
    document_version_textfield_name: ['', Validators.required],
    version_text_field_version_id: ['', Validators.required],
    version_textarea_description: ['']
  });

  readonly rows = signal<Row[]>([]);
  okCount = () => this.rows().filter((r) => r.state === 'ok').length;

  onDrop(e: DragEvent): void { e.preventDefault(); this.add(Array.from(e.dataTransfer?.files ?? [])); }
  onPick(e: Event): void { this.add(Array.from((e.target as HTMLInputElement).files ?? [])); }

  private add(files: File[]): void {
    files.forEach((file) => {
      // Client-side guard mirrors VersionUtil.validateDocumentOperation; the
      // server remains authoritative and its message is shown verbatim.
      if (file.type !== 'application/pdf') {
        this.rows.update((r) => [...r, { file, state: 'error', message: SERVER_MESSAGE.nonPdf(file.name) }]);
        return;
      }
      this.rows.update((r) => [...r, { file, state: 'uploading' }]);
      this.data.uploadVersionFile(this.folderId(), file).subscribe((res) =>
        this.rows.update((rows) => rows.map((r) =>
          r.file === file ? { ...r, state: res.ok ? 'ok' : 'error', message: res.message } : r)));
    });
  }

  ext = (n: string) => n.split('.').pop()?.toUpperCase() ?? '';
  size = (f: File) => `${(f.size / 1_048_576).toFixed(1)} MB`;
}
