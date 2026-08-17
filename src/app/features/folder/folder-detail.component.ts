import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { Observable, catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { SessionService } from '@core/services/session.service';
import { PageSubtitleService } from '@core/services/page-subtitle.service';
import { DOCUMENT_VERSION_ACKNOWLEDGEMENT_SECTION_ID, INFORMATION_FOLDER_VERSIONS_SECTION_ID, OBJECT_ID } from '@core/objects';
import { AckStatus, InformationFolder } from '@core/models';
import { completion } from '@core/rollup';
import { canDelete, isFieldEditable } from '@core/folder-rules';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { CompletionBarComponent } from '@shared/ui/completion-bar.component';
import { MultiSelectDropdownComponent } from '@shared/ui/multi-select-dropdown.component';
import { SyncDiagnosticsComponent } from './sync-diagnostics.component';
import { VersionTimelineComponent } from './version-timeline.component';
import { AudienceBuilderComponent } from '@features/distribution/audience-builder.component';

/**
 * This generic REST GET endpoint's exact shape for a MULTI_PICK_LIST field isn't confirmed
 * live yet (unlike picklist/lookup fields, which are confirmed {displayValue, content, ...}
 * objects here) — handles a plain comma-string (the create-time convention), an array, or an
 * object exposing one, and never throws on anything else, so a real-world mismatch degrades to
 * an empty selection instead of crashing the whole folder fetch (and blanking the entire page).
 */
function parseDocumentLanguages(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') return value.split(',').map((v) => v.trim()).filter(Boolean);
  if (value && typeof value === 'object') {
    const inner = (value as any).content ?? (value as any).displayValue;
    if (typeof inner === 'string') return inner.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

/** UC-IP-07 / UC-ADM-06. Active = frozen; the diagnostic strip explains silence. */
@Component({
  selector: 'im-folder-detail',
  standalone: true,
  imports: [
    RouterLink, ReactiveFormsModule, StatusBadgeComponent, CompletionBarComponent, MultiSelectDropdownComponent,
    SyncDiagnosticsComponent, VersionTimelineComponent, AudienceBuilderComponent
  ],
  templateUrl: './folder-detail.component.html',
  styleUrl: './folder-detail.component.scss'
})
export class FolderDetailComponent {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);
  readonly session = inject(SessionService);
  readonly lang = inject(LanguageService);
  private readonly pageSubtitle = inject(PageSubtitleService);
  private readonly destroyRef = inject(DestroyRef);

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

  constructor() {
    // Shell topbar shows a generic "Information folder" title here — this fills in the real folder name as its subtitle, same mechanism task-list.component.ts uses for its own open/overdue counts.
    effect(() => {
      const name = this.folder()?.information_folder_textfield_name;
      if (name) this.pageSubtitle.set(name);
    });
    this.destroyRef.onDestroy(() => this.pageSubtitle.clear());
  }

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
  /** Deactivated folders allow editing everything except short name/name/status — the rest is locked to deadline+description only. */
  readonly canEditWhenInactive = computed(() => this.folder()?.information_folder_picklist_status === 'Inactive');
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
    information_folder_number_deadlinedays: [0, [Validators.required, Validators.min(1)]],
    information_folder_textfield_description: [''],
    information_folder_picklist_confidentiality_level: ['Internal'],
    information_folder_textfield_document_category: [''],
    information_folder_multi_select_picklist_document_language: this.fb.nonNullable.control<string[]>([]),
    information_folder_lookup_responsible_team: ['']
  });
  private static readonly EXTENDED_FIELDS = [
    'information_folder_picklist_confidentiality_level',
    'information_folder_textfield_document_category',
    'information_folder_multi_select_picklist_document_language',
    'information_folder_lookup_responsible_team'
  ] as const;

  /** Same "teams I belong to" restriction the wizard's own Responsible Team picker uses at creation time. */
  readonly myTeams = toSignal(
    toObservable(computed(() => this.session.session().userId)).pipe(
      switchMap((userId) => {
        if (!userId) return of([] as { recordId: string; teamName: string }[]);
        return this.http.get<any>(`/networking/rest/record/${OBJECT_ID.informationManagerTeamsUsers}`, {
          params: {
            filter: `(imt_if_text_field_copy_userId equals '${userId}')`,
            fieldList: 'id,informationmanagerteams_record', pageSize: 50, getTotalRecordCount: true, alt: 'json'
          }
        }).pipe(
          map((response): { recordId: string; teamName: string }[] =>
            [response?.platform?.record ?? []].flat().map((r: any) => ({
              recordId: r.id, teamName: r.informationmanagerteams_record?.displayValue ?? ''
            }))),
          catchError((err) => { console.error('My teams fetch failed', err); return of([] as { recordId: string; teamName: string }[]); })
        );
      })
    ),
    { initialValue: [] as { recordId: string; teamName: string }[] }
  );

  /** Same live enum fetch the wizard's own Document Language field uses — not hardcoded, since this tenant's config is the source of truth. */
  readonly documentLanguages = toSignal(
    this.http.get<any>('/networking/solution/ServiceDesk/CaseRecordPage', {
      params: { object_id: OBJECT_ID.informationFolder, id: '-1', _component_: 'formInfo', alt: 'json' }
    }).pipe(
      map((response): string[] => {
        const sections = response?.formInfo?.sections ?? [];
        for (const section of sections) {
          for (const fieldGroup of section.fields ?? []) {
            for (const fieldList of Object.values(fieldGroup) as any[][]) {
              const field = fieldList.find((f) => f.tableColumn === 'information_folder_multi_select_picklist_document_language');
              if (field) return field.sortedEnumerationDetails ?? [];
            }
          }
        }
        return [];
      }),
      catchError((err) => { console.error('Document language field fetch failed', err); return of([] as string[]); })
    ),
    { initialValue: [] as string[] }
  );

  startEdit(f: InformationFolder): void {
    this.editForm.setValue({
      information_folder_number_deadlinedays: f.information_folder_number_deadlinedays,
      information_folder_textfield_description: f.information_folder_textfield_description ?? '',
      information_folder_picklist_confidentiality_level: f.information_folder_picklist_confidentiality_level,
      information_folder_textfield_document_category: f.information_folder_textfield_document_category ?? '',
      information_folder_multi_select_picklist_document_language: f.information_folder_multi_select_picklist_document_language ?? [],
      information_folder_lookup_responsible_team: f.responsibleTeamId ?? ''
    });
    const canEditExtended = f.information_folder_picklist_status === 'Inactive';
    FolderDetailComponent.EXTENDED_FIELDS.forEach((name) =>
      canEditExtended ? this.editForm.controls[name].enable() : this.editForm.controls[name].disable());
    this.saveError.set('');
    this.editing.set(true);
  }

  saveMetadata(folderId: string): void {
    if (this.editForm.invalid) return;
    this.saving.set(true);
    this.saveError.set('');
    const v = this.editForm.getRawValue();
    this.http.put<any>(`/networking/solution/ServiceDesk/record/${OBJECT_ID.informationFolder}/${folderId}`, {
      ...v,
      information_folder_multi_select_picklist_document_language: v.information_folder_multi_select_picklist_document_language.join(','),
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
        this.lastModifiedTimestamp.set(r.last_modified_timestamp ?? '');
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
          information_folder_lookup_responsible_team: r.information_folder_lookup_responsible_team?.displayValue ?? r.information_folder_lookup_responsible_team ?? '',
          responsibleTeamId: r.information_folder_lookup_responsible_team?.content ?? '',
          information_folder_multi_select_picklist_document_language:
            parseDocumentLanguages(r.information_folder_multi_select_picklist_document_language),
          created_id: r.created_id?.displayValue ?? ''
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
