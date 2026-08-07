import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { DataPort } from '@core/services/data.port';
import { LanguageService } from '@core/i18n/language.service';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { DocumentVersion } from '@core/models';

/** Read-only record view for a single document version, reached from the folder's version timeline. */
@Component({
  selector: 'im-version-detail',
  standalone: true,
  imports: [RouterLink, StatusBadgeComponent],
  styleUrl: './version-detail.component.scss',
  template: `
    <a class="back" [routerLink]="['/folders', id()]">← {{ folder()?.information_folder_textfield_name ?? id() }}</a>

    @if (version(); as v) {
      <section class="card">
        <header class="head">
          <im-status-badge [status]="v.version_picklist_version_status" [dot]="false" />
          <h1>{{ v.document_version_textfield_name }}</h1>
        </header>

        <div class="grid">
          <div class="field">
            <span class="label">{{ lang.isGerman() ? 'Informationsordner' : 'Information Folder' }}</span>
            <a [routerLink]="['/folders', id()]">{{ folder()?.information_folder_textfield_name ?? id() }}</a>
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

        <div class="documents">
          <span class="label">{{ lang.isGerman() ? 'Dokument' : 'Document' }}</span>
          <ul class="files">
            @for (n of documentPlaceholders(); track n) {
              <li>
                <span class="kind">PDF</span>
                <span class="meta">
                  <strong>{{ v.document_version_textfield_name }}{{ documentPlaceholders().length > 1 ? ' (' + n + ')' : '' }}.pdf</strong>
                  <small>{{ lang.isGerman() ? 'Platzhalter — wird später aus ECAP geladen' : 'Placeholder — will be fetched from ECAP later' }}</small>
                </span>
                <button type="button" class="ghost" disabled>{{ lang.isGerman() ? 'Öffnen' : 'Open' }}</button>
              </li>
            } @empty {
              <p class="missing">{{ lang.isGerman() ? 'Keine Dokumente hinterlegt.' : 'No documents on file.' }}</p>
            }
          </ul>
        </div>
      </section>
    } @else {
      <p class="missing">{{ lang.isGerman() ? 'Version nicht gefunden.' : 'Version not found.' }}</p>
    }
  `
})
export class VersionDetailComponent {
  private readonly data = inject(DataPort);
  readonly lang = inject(LanguageService);

  readonly id = input.required<string>();
  readonly versionId = input.required<string>();

  private readonly versions = toSignal(
    toObservable(this.id).pipe(switchMap((folderId) => this.data.versions(folderId))),
    { initialValue: [] as DocumentVersion[] });
  readonly version = computed(() => this.versions().find((v) => v.id === this.versionId()));

  readonly folder = toSignal(toObservable(this.id).pipe(switchMap((folderId) => this.data.folder(folderId))));

  /** No real file storage wired up yet — one placeholder row per document until ECAP integration lands. */
  readonly documentPlaceholders = computed(() => {
    const n = this.version()?.version_number_total_document_count ?? 0;
    return Array.from({ length: n }, (_, i) => i + 1);
  });
}
