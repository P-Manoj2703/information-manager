import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { Observable, catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { SessionService } from '@core/services/session.service';
import { DOCUMENT_VERSION_ACKNOWLEDGEMENT_SECTION_ID, INFORMATION_FOLDER_VERSIONS_SECTION_ID, OBJECT_ID } from '@core/objects';
import { AckStatus, InformationFolder } from '@core/models';
import { completion } from '@core/rollup';
import { canDelete, isFieldEditable } from '@core/folder-rules';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { CompletionBarComponent } from '@shared/ui/completion-bar.component';
import { SyncDiagnosticsComponent } from './sync-diagnostics.component';
import { VersionTimelineComponent } from './version-timeline.component';
import { AudienceBuilderComponent } from '@features/distribution/audience-builder.component';

/** UC-IP-07 / UC-ADM-06. Active = frozen; the diagnostic strip explains silence. */
@Component({
  selector: 'im-folder-detail',
  standalone: true,
  imports: [
    RouterLink, ReactiveFormsModule, StatusBadgeComponent, CompletionBarComponent,
    SyncDiagnosticsComponent, VersionTimelineComponent, AudienceBuilderComponent
  ],
  styleUrl: './folder-detail.component.scss',
  template: `
    <a class="back" routerLink="/folders">← {{ lang.t('folders') }}</a>

    @if (folder(); as f) {
      <header class="hero">
        <div class="hero__top">
          <div>
            <im-status-badge [status]="f.information_folder_picklist_status" />
            <h1>{{ f.information_folder_textfield_name }}</h1>
          </div>
          <div class="hero__actions">
            @if (canEditMetadata()) {
              <button type="button" class="ghost" (click)="startEdit(f)">{{ editButtonLabel() }}</button>
              <button type="button" class="ghost" (click)="showAudienceBuilder.set(!showAudienceBuilder())">
                {{ showAudienceBuilder()
                  ? (lang.isGerman() ? 'Zielgruppe schließen' : 'Close audience')
                  : (lang.isGerman() ? 'Nutzer / Einheit hinzufügen' : 'Add user / unit') }}
              </button>
            }
            <a class="primary" [routerLink]="['/folders', f.id, 'versions', 'new']">{{ lang.t('newVersion') }}</a>
          </div>
        </div>
        <im-sync-diagnostics [folderId]="f.id" [refreshTick]="refresh()" />
      </header>

      @if (showAudienceBuilder()) {
        <im-audience-builder [folderId]="f.id" (continue)="onAudienceUpdated()" />
      }

      @if (frozen()) {
        <p class="frozen">
          {{ lang.isGerman()
            ? 'Dieser Ordner ist veröffentlicht und gesperrt. Nur Frist und Beschreibung sind bearbeitbar — alle weiteren Änderungen erfordern Deaktivieren → Bearbeiten → Aktivieren.'
            : 'This folder is published and frozen. Only the deadline and description are editable — any further change requires deactivate → edit → activate.' }}
        </p>
      }

      @if (editing()) {
        <form class="card edit-card" [formGroup]="editForm" (ngSubmit)="saveMetadata(f.id)">
          <h2>{{ lang.isGerman() ? 'Metadaten bearbeiten' : 'Edit metadata' }}</h2>
          @if (saveError()) { <p class="error">{{ saveError() }}</p> }
          <div class="grid">
            <label>{{ lang.isGerman() ? 'Kurzname' : 'Short name' }}
              <input [value]="f.information_folder_textfield_short_name ?? ''" disabled>
            </label>
            <label>{{ lang.isGerman() ? 'Name' : 'Name' }}
              <input [value]="f.information_folder_textfield_name" disabled>
            </label>
            <label>{{ lang.isGerman() ? 'Frist (Tage)' : 'Deadline (days)' }} *
              <input type="number" min="1" formControlName="information_folder_number_deadlinedays">
            </label>
            <label>{{ lang.isGerman() ? 'Vertraulichkeit' : 'Confidentiality' }}
              <input [value]="f.information_folder_picklist_confidentiality_level" disabled>
            </label>
            <label>{{ lang.isGerman() ? 'Dokumentkategorie' : 'Document category' }}
              <input [value]="f.information_folder_textfield_document_category ?? ''" disabled>
            </label>
            <label>{{ lang.isGerman() ? 'Status' : 'Status' }}
              <input [value]="f.information_folder_picklist_status" disabled>
            </label>
            <label>{{ lang.isGerman() ? 'Verantwortliches Team' : 'Responsible team' }}
              <input [value]="f.information_folder_lookup_responsible_team" disabled>
            </label>
          </div>
          <label class="wide">{{ lang.isGerman() ? 'Beschreibung' : 'Description' }}
            <textarea rows="3" formControlName="information_folder_textfield_description"></textarea>
          </label>
          <footer>
            <button type="button" class="ghost-light" (click)="editing.set(false)">{{ lang.isGerman() ? 'Abbrechen' : 'Cancel' }}</button>
            <button type="submit" class="primary-light" [disabled]="editForm.invalid || saving()">
              {{ lang.isGerman() ? 'Speichern' : 'Save' }}
            </button>
          </footer>
        </form>
      }

      <div class="cols">
        <section class="card">
          <h2>{{ lang.isGerman() ? 'Abschlussgrad' : 'Completion' }}</h2>
          <im-completion-bar [data]="stats()" />
          <im-version-timeline [folderId]="f.id" />
        </section>
      </div>
    }
  `
})
export class FolderDetailComponent {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);
  readonly session = inject(SessionService);
  readonly lang = inject(LanguageService);

  readonly id = input.required<string>();
  readonly refresh = signal(0);
  /**
   * Adding a user/org unit here triggers real ECAP automation immediately (confirmed via the
   * tenant's own event rules): Employees' "User Acknowledgment Synchronization To Users When
   * Version is Active" and Organizational_Units' equivalent both fire on Created and create
   * the missing Acknowledgement for whoever was just added, as long as the folder isn't
   * Inactive — no extra client-side logic needed beyond letting them add the record.
   */
  readonly showAudienceBuilder = signal(false);

  private readonly lastModifiedTimestamp = signal('');
  readonly folder = toSignal(
    combineLatest([toObservable(this.id), toObservable(this.refresh)]).pipe(
      switchMap(([id]) => this.fetchFolder(id))));

  /** The Active version's own Acknowledgement rows — the real, server-resolved audience, not a client-side guess. */
  private readonly acks = toSignal(
    toObservable(this.id).pipe(switchMap((id) => this.fetchActiveVersionAcks(id))),
    { initialValue: [] as AckStatus[] });

  readonly stats = computed(() => completion(this.acks()));
  readonly frozen = computed(() => this.folder()?.information_folder_picklist_status === 'Active');
  /** Every status (Draft/Active/Inactive) allows editing something — isFieldEditable() decides what; the button itself only depends on role. */
  readonly canEditMetadata = computed(() => this.session.canCreateFolder() && !!this.folder());
  readonly editButtonLabel = computed(() => this.frozen() ? this.lang.t('editPublished') : (this.lang.isGerman() ? 'Ordner bearbeiten' : 'Edit folder'));
  readonly showDelete = computed(() => { const f = this.folder(); return !!f && canDelete(f); });
  editable(field: Parameters<typeof isFieldEditable>[1]): boolean {
    const f = this.folder();
    return !!f && isFieldEditable(f, field);
  }

  onAudienceUpdated(): void {
    this.showAudienceBuilder.set(false);
    this.refresh.update((n) => n + 1);
  }

  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly saveError = signal('');
  readonly editForm = this.fb.nonNullable.group({
    information_folder_number_deadlinedays: [14, [Validators.required, Validators.min(1)]],
    information_folder_textfield_description: ['']
  });

  startEdit(f: InformationFolder): void {
    this.editForm.setValue({
      information_folder_number_deadlinedays: f.information_folder_number_deadlinedays,
      information_folder_textfield_description: f.information_folder_textfield_description ?? ''
    });
    this.saveError.set('');
    this.editing.set(true);
  }

  saveMetadata(folderId: string): void {
    if (this.editForm.invalid) return;
    this.saving.set(true);
    this.saveError.set('');
    this.http.put<any>(`/networking/solution/ServiceDesk/record/${OBJECT_ID.informationFolder}/${folderId}`, {
      ...this.editForm.getRawValue(),
      last_modified_timestamp: this.lastModifiedTimestamp()
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.editing.set(false);
        this.refresh.update((n) => n + 1);
      },
      error: (err) => {
        console.error('Folder metadata update failed', err);
        this.saving.set(false);
        this.saveError.set(err?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Speichern fehlgeschlagen.' : 'Save failed.'));
      }
    });
  }

  private fetchFolder(id: string): Observable<InformationFolder | undefined> {
    if (!id) return of(undefined);
    return this.http.get<any>(`/networking/rest/record/${OBJECT_ID.informationFolder}/${id}`, {
      params: { alt: 'json' }
    }).pipe(
      map((response): InformationFolder | undefined => {
        const r = response?.platform?.record;
        if (!r) return undefined;
        this.lastModifiedTimestamp.set(r.date_modified ?? '');
        return {
          id: r.id,
          information_folder_textfield_name: r.information_folder_textfield_name ?? '',
          information_folder_textfield_short_name: r.information_folder_textfield_short_name ?? '',
          information_folder_textfield_description: r.information_folder_textfield_description ?? '',
          information_folder_richtext_area_user_information: r.information_folder_richtext_area_user_information ?? '',
          information_folder_textfield_document_category: r.information_folder_textfield_document_category ?? '',
          // Picklist AND Lookup fields both come back as {displayValue, content, ...} objects from
          // this endpoint (confirmed live) — not the {name, id} shape the CaseRecordPage-style
          // endpoint used elsewhere in this app returns, and not a plain string either.
          information_folder_picklist_confidentiality_level: r.information_folder_picklist_confidentiality_level?.content ?? 'Internal',
          information_folder_picklist_status: r.information_folder_picklist_status?.content ?? 'Draft',
          information_folder_picklist_acknowledgment_status: r.information_folder_picklist_acknowledgment_status?.content ?? 'None',
          information_folder_number_deadlinedays: Number(r.information_folder_number_deadlinedays ?? 0),
          information_folder_lookup_responsible_team: r.information_folder_lookup_responsible_team?.displayValue ?? r.information_folder_lookup_responsible_team ?? ''
        };
      }),
      catchError((err) => { console.error('Folder fetch failed', err); return of(undefined); })
    );
  }

  /**
   * Same active-version-then-acks lookup as the sync diagnostics strip — kept local rather
   * than shared, matching this codebase's existing per-component fetch convention. Goes
   * through the real relatedObjectList endpoint (confirmed live), not the generic
   * rest/record/{oid}?filter=... list endpoint, which proved unreliable for this exact
   * object/folder combination independent of retries or page size.
   */
  private fetchActiveVersionAcks(folderId: string): Observable<AckStatus[]> {
    if (!folderId) return of([]);
    return this.http.get<any>('/networking/solution/ServiceDesk/relatedObjectList', {
      params: {
        record_id: folderId, p_objectId: OBJECT_ID.informationFolder,
        related_section_id: INFORMATION_FOLDER_VERSIONS_SECTION_ID,
        paginationRequired: true, page: 1, pageSize: 200, _uiVersion: 3, sortBy: 'date_modified', sortOrder: 'desc'
      }
    }).pipe(
      switchMap((response) => {
        const rows = response?.[INFORMATION_FOLDER_VERSIONS_SECTION_ID]?.relatedInfoData ?? [];
        const activeVersionId = rows.find((r: any) => r.version_picklist_version_status === 'Active')?.id;
        if (!activeVersionId) return of([] as AckStatus[]);
        return this.http.get<any>('/networking/solution/ServiceDesk/relatedObjectList', {
          params: {
            record_id: activeVersionId, p_objectId: OBJECT_ID.documentVersion,
            related_section_id: DOCUMENT_VERSION_ACKNOWLEDGEMENT_SECTION_ID,
            paginationRequired: true, page: 1, pageSize: 200, _uiVersion: 3
          }
        }).pipe(
          map((r) => (r?.[DOCUMENT_VERSION_ACKNOWLEDGEMENT_SECTION_ID]?.relatedInfoData ?? [])
            .map((row: any): AckStatus => row.acknowledgment_picklist_status ?? 'Pending'))
        );
      }),
      catchError((err) => { console.error('Acknowledgement fetch failed', err); return of([] as AckStatus[]); })
    );
  }
}
