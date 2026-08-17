import { Component, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of, switchMap } from 'rxjs';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RecordCreateDirective } from '@escriba/cui-ecap-runtime';
import { INFORMATION_FOLDER_LAYOUT_ID, OBJECT_ID } from '@core/objects';
import { LanguageService } from '@core/i18n/language.service';
import { SessionService } from '@core/services/session.service';
import { AudienceBuilderComponent } from '@features/distribution/audience-builder.component';
import { MultiSelectDropdownComponent } from '@shared/ui/multi-select-dropdown.component';
import { VersionUploadComponent } from './version-upload.component';
import { ActivateDialogComponent } from './activate-dialog.component';

/**
 * UC-IP-01. Four steps, shown from the first screen: the platform hides the
 * audience subforms until the record exists, so a save is not the end.
 */
@Component({
  selector: 'im-folder-wizard',
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, RecordCreateDirective, AudienceBuilderComponent, VersionUploadComponent, ActivateDialogComponent, MultiSelectDropdownComponent],
  templateUrl: './folder-wizard.component.html',
  styleUrl: './folder-wizard.component.scss'
})
export class FolderWizardComponent {
  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionService);
  readonly lang = inject(LanguageService);

  readonly OBJECT_ID = OBJECT_ID;

  readonly step = signal(1);
  readonly folderId = signal('');

  /**
   * Each step component mounts once, the first time its step is reached, and then stays alive
   * (just hidden, never destroyed) for the rest of the wizard's lifetime — confirmed live that
   * @switch's normal destroy/recreate behavior wiped VersionUploadComponent's local draft state
   * (typed fields, queued files not yet saved) the moment the user navigated to a different
   * step and back, even though nothing was actually lost server-side (nothing had been saved
   * yet). Real per-row persistence (Audience's team/user adds, an already-saved Document
   * Version) isn't at risk either way, since that lives in ECAP, not this component tree.
   */
  readonly visitedSteps = signal<Set<number>>(new Set([1]));

  constructor() {
    effect(() => {
      const s = this.step();
      this.visitedSteps.update((set) => set.has(s) ? set : new Set([...set, s]));
    }, { allowSignalWrites: true });
  }

  /** Steps past 1 need the real folder record to exist first — confirmed live that clicking straight to "Audience" before that left folderId empty, silently no-oping every add action with zero visible error. */
  goToStep(n: number): void {
    if (n > 1 && !this.folderId()) return;
    this.step.set(n);
  }

  readonly versionRecordId = signal('');
  readonly teamCount = signal(0);
  readonly userCount = signal(0);
  readonly busy = signal(false);
  readonly createError = signal('');
  readonly createPayload = signal<Record<string, unknown> | null>(null);

  /**
   * information_folder_lookup_responsible_team's real target is the Information Manager
   * Teams x Users junction object (2390c38b2ffe45feab68d882cc2a0105) — one row per team a
   * given user belongs to. Fetching it unfiltered is the same unreliable LOOKUP.TABLEDATA
   * pattern seen elsewhere in this tenant (confirmed live: pageSize 100 -> 32 of 132 rows,
   * pageSize 200 -> 0 rows) — but filtering by this user's own id sidesteps it entirely: the
   * result is naturally small (their own team memberships), and came back exact and complete
   * on every live check (recordCount === totalRecordCount), no retry-hardening needed.
   */
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

  /**
   * Fetched live from the same CaseRecordPage form-info endpoint ECAP's own
   * native "New Information Folder" form uses (id=-1 = new-record mode,
   * _component_=formInfo returns field defs without needing an existing
   * record). The field's enumerated values live at
   * field.sortedEnumerationDetails — confirmed against the live response.
   */
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

  readonly steps = [
    { n: 1, de: 'Metadaten', en: 'Metadata' },
    { n: 2, de: 'Zielgruppe', en: 'Audience' },
    { n: 3, de: 'Dokumentversion', en: 'Document version' },
    { n: 4, de: 'Veröffentlichen', en: 'Publish' }
  ];

  readonly form = this.fb.nonNullable.group({
    information_folder_textfield_name: ['', Validators.required],
    information_folder_textfield_short_name: [''],
    information_folder_textfield_description: [''],
    // this.fb.control(...) rather than the surrounding nonNullable.group's array shorthand: needs to start genuinely empty (null), not a nonNullable default like 0 — see the field's own touched-error message below.
    information_folder_number_deadlinedays: this.fb.control<number | null>(null, [Validators.required, Validators.min(1)]),
    information_folder_lookup_responsible_team: ['', Validators.required],
    information_folder_picklist_confidentiality_level: ['Internal', Validators.required],
    information_folder_textfield_document_category: [''],
    information_folder_multi_select_picklist_document_language: this.fb.nonNullable.control<string[]>([]),
    information_folder_richtext_area_user_information: ['', Validators.required]
  });

  get deadlineDays() { return this.form.controls.information_folder_number_deadlinedays; }

  /**
   * The folder record must only ever be created once — visitedSteps keeps this form mounted
   * (not destroyed) so navigating to Audience and back leaves it fully live. Once folderId is
   * set, this click updates the same existing record instead (updateDraft) — confirmed live
   * that re-submitting the create payload here produced a real duplicate Information Folder.
   */
  saveDraft(): void {
    if (this.busy()) return;
    if (this.form.invalid) {
      // Save is never disabled by validity — clicking it while something's wrong is how the user finds out, instead of a silently-disabled button. markAllAsTouched() surfaces every field's own inline error (e.g. deadlineDays' "Please enter a number of days").
      this.form.markAllAsTouched();
      this.createError.set(this.lang.isGerman()
        ? 'Bitte alle Pflichtfelder korrekt ausfüllen, bevor Sie speichern.'
        : 'Please fill in all required fields correctly before saving.');
      return;
    }
    if (this.folderId()) { this.updateDraft(); return; }
    this.busy.set(true);
    this.createError.set('');
    const v = this.form.getRawValue();
    this.createPayload.set({
      ...v,
      // ECAP expects multi-value picklists as a comma-joined string, not a JSON array.
      information_folder_multi_select_picklist_document_language: v.information_folder_multi_select_picklist_document_language.join(','),
      // Native form auto-assigns this via a form rule (user.id) that only runs in ECAP's own UI — replicated here.
      information_folder_text_field_userid: this.session.session().userId,
      // Must be explicit, not omitted: same class of bug confirmed on Document Version — an
      // unset picklist reads as blank, which still shows in an unfiltered "All Records" view
      // but fails an exact-match filter for a specific status like a "Draft" tab.
      information_folder_picklist_status: 'Draft',
      layout_id: INFORMATION_FOLDER_LAYOUT_ID,
      _request_id: crypto.randomUUID(),
      _gridSectionsRecords_: {},
      last_modified_timestamp: ''
    });
  }

  /** Real update of the already-created folder — PUT, not PATCH: PATCH is silently accepted (200/success body) but never actually persists on this tenant. */
  private updateDraft(): void {
    const folderId = this.folderId();
    if (!folderId) return;
    this.busy.set(true);
    this.createError.set('');
    const v = this.form.getRawValue();

    this.http.get<any>(`/networking/rest/record/${OBJECT_ID.informationFolder}/${folderId}`, {
      params: { fieldList: 'last_modified_timestamp', alt: 'json' }
    }).pipe(
      switchMap((response) => {
        const lastModifiedTimestamp = response?.platform?.record?.last_modified_timestamp ?? '';
        return this.http.put<any>(`/networking/solution/ServiceDesk/record/${OBJECT_ID.informationFolder}/${folderId}`, {
          ...v,
          information_folder_multi_select_picklist_document_language: v.information_folder_multi_select_picklist_document_language.join(','),
          layout_id: INFORMATION_FOLDER_LAYOUT_ID,
          last_modified_timestamp: lastModifiedTimestamp
        });
      })
    ).subscribe({
      next: () => {
        this.busy.set(false);
        this.step.set(2);
      },
      error: (err) => {
        console.error('Information folder update failed', err);
        this.busy.set(false);
        this.createError.set(err?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Aktualisierung fehlgeschlagen.' : 'Update failed.'));
      }
    });
  }

  onCreateResponse(response: any): void {
    this.busy.set(false);
    this.createPayload.set(null);
    // Server stamps User Id + Primary Team Id on create; response echoes the new record's id.
    this.folderId.set(String(response?.record?.id ?? response?.id ?? ''));
    this.step.set(2);
  }

  onCreateError(error: HttpErrorResponse): void {
    this.busy.set(false);
    this.createPayload.set(null);
    this.createError.set(error.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Speichern fehlgeschlagen.' : 'Save failed.'));
  }

  onAudienceContinue(counts: { teamCount: number; userCount: number }): void {
    this.teamCount.set(counts.teamCount);
    this.userCount.set(counts.userCount);
    this.step.set(3);
  }

  onVersionSaved(versionId: string): void {
    this.versionRecordId.set(versionId);
    this.step.set(4);
  }
}
