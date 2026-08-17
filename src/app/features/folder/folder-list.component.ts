import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RecordListDirective, RecordsPayloadMeta, RecordsResponseMeta } from '@escriba/cui-ecap-runtime';
import { AckStatus, Confidentiality, FolderStatus, InformationFolder } from '@core/models';
import { completion } from '@core/rollup';
import { ACKNOWLEDGEMENT_VIEW_ID, API_BASE, INFORMATION_FOLDER_ACTIVATE_MACRO_ID, INFORMATION_FOLDER_DEACTIVATE_MACRO_ID, INFORMATION_FOLDER_VIEW_ID, OBJECT_ID } from '@core/objects';
import { SessionService } from '@core/services/session.service';
import { LanguageService } from '@core/i18n/language.service';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { CompletionBarComponent } from '@shared/ui/completion-bar.component';
import { FilterChipsComponent, Chip } from '@shared/ui/filter-chips.component';
import { EmptyStateComponent } from '@shared/ui/empty-state.component';
import { ColumnFilterComponent, ColumnFilterOption } from '@shared/ui/column-filter.component';
import { PagerComponent } from '@shared/ui/pager.component';

/**
 * Real ECAP field names for server-side filtering, confirmed live via network capture
 * (2026-08-14) against ListDataPage's own `filter` query param, on this exact object
 * (Information_Folder): (field equals 'v1' OR field equals 'v2') AND (field2 equals 'v3') —
 * one parenthesized OR-group per column with values selected, groups joined by AND.
 * Confidentiality/status/rollup are picklist fields — the highest-confidence case, since the
 * captured examples used these exact two fields (status + acknowledgment status). Name is a
 * plain text field, same confidence as Employee/Folder elsewhere in this app. Responsible team
 * is the one unverified case here — an object/lookup field, filtered by its display name as a
 * best-effort extension of the pattern, same caveat as "Version" on the other tabs.
 */
const FILTER_FIELD = {
  name: 'information_folder_textfield_name',
  confidentiality: 'information_folder_picklist_confidentiality_level',
  status: 'information_folder_picklist_status',
  rollup: 'information_folder_picklist_acknowledgment_status',
  responsibleTeam: 'information_folder_lookup_responsible_team'
} as const;

/** Saved views from the tenant: My / My Teams × Active / Draft / Inactive. */
@Component({
  selector: 'im-folder-list',
  standalone: true,
  imports: [RouterLink, RecordListDirective, StatusBadgeComponent, CompletionBarComponent, FilterChipsComponent, EmptyStateComponent, ColumnFilterComponent, PagerComponent],
  templateUrl: './folder-list.component.html',
  styleUrl: './folder-list.component.scss'
})
export class FolderListComponent {
  private readonly http = inject(HttpClient);
  private readonly route = inject(ActivatedRoute);
  readonly session = inject(SessionService);
  readonly lang = inject(LanguageService);
  readonly view = signal('myActive');
  readonly busy = signal<string | null>(null);
  readonly actionError = signal<{ folderId: string; message: string } | null>(null);

  /** Empty array = no filter applied for that column. */
  readonly nameFilter = signal<string[]>([]);
  readonly confidentialityFilter = signal<string[]>([]);
  readonly statusFilter = signal<string[]>([]);
  readonly rollupFilter = signal<string[]>([]);
  readonly responsibleTeamFilter = signal<string[]>([]);
  /**
   * Free-text name search — separate from the Name column filter dropdown above. Applied
   * client-side (see `visible` below) against whatever's already loaded for the current tab,
   * not sent to ECAP as a `filter` condition — a `contains`-style operator was tried there
   * first but didn't behave as expected, so this searches the already-fetched rows instead of
   * guessing at unconfirmed ECAP filter syntax a second time.
   */
  readonly nameSearch = signal('');

  /** Drives the single "Reset filters" link — shown only while at least one column filter is active. */
  readonly anyColumnFilterActive = computed(() =>
    !!(this.nameFilter().length || this.confidentialityFilter().length || this.statusFilter().length
      || this.rollupFilter().length || this.responsibleTeamFilter().length || this.nameSearch().trim()));

  resetAllColumnFilters(): void {
    this.nameFilter.set([]);
    this.confidentialityFilter.set([]);
    this.statusFilter.set([]);
    this.rollupFilter.set([]);
    this.responsibleTeamFilter.set([]);
    this.nameSearch.set('');
  }

  /**
   * Arriving from Estate Overview's status buckets: ?view=all&rollup=Pending pre-selects the
   * "All" tab and the roll-up column filter, so Compliance lands directly on the matching
   * folders instead of having to set both by hand.
   */
  constructor() {
    const queryParams = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
    effect(() => {
      const params = queryParams();
      const view = params.get('view');
      const rollup = params.get('rollup');
      if (view) this.view.set(view);
      if (rollup) this.rollupFilter.set([rollup]);
    }, { allowSignalWrites: true });

    effect(() => {
      const count = this.viewIds().length;
      this.folderPartials.set(Array.from({ length: count }, () => []));
      this.optionsPartials.set(Array.from({ length: count }, () => []));
      this.loaded.set(Array.from({ length: count }, () => false));
    }, { allowSignalWrites: true });

    // Any change that could shrink or reorder the visible set should land back on page 1 —
    // otherwise switching tabs/filters can leave the pager stuck past the new last page.
    effect(() => {
      this.view(); this.nameFilter(); this.confidentialityFilter(); this.statusFilter();
      this.rollupFilter(); this.responsibleTeamFilter(); this.nameSearch();
      this.pageSize();
      this.currentPage.set(1);
    }, { allowSignalWrites: true });

    // A fresh tab gets a fresh retry budget for the flakiness workaround below.
    effect(() => {
      this.view();
      this.emptyRetryCount.set(0);
    }, { allowSignalWrites: true });
  }

  /**
   * The chip bar's own click handler — deliberately separate from the query-param effect
   * above, which also writes `view` (paired with a rollup filter) when arriving from Estate
   * Overview's status buckets. Only a real manual tab switch should clear the column filters;
   * clearing them on every `view` write would immediately wipe that intentional deep-link filter.
   */
  selectView(id: string): void {
    this.nameFilter.set([]);
    this.confidentialityFilter.set([]);
    this.statusFilter.set([]);
    this.rollupFilter.set([]);
    this.responsibleTeamFilter.set([]);
    this.nameSearch.set('');
    this.view.set(this.view() === id ? 'all' : id);
  }

  readonly pageSize = signal(10);
  readonly currentPage = signal(1);

  readonly pagedVisible = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.visible().slice(start, start + this.pageSize());
  });

  readonly confidentialityOptions: ColumnFilterOption[] =
    (['Internal', 'Public', 'Confidential'] as Confidentiality[]).map((c) => ({ value: c, label: c }));

  private readonly STATUS_LABEL: Record<FolderStatus, [string, string]> = {
    Draft: ['Entwurf', 'Draft'], Active: ['Aktiv', 'Active'], Inactive: ['Inaktiv', 'Inactive']
  };
  private readonly ROLLUP_LABEL: Record<AckStatus, [string, string]> = {
    None: ['Keine', 'None'], Pending: ['Offen', 'Pending'], Overdue: ['Überfällig', 'Overdue'],
    Done: ['Erledigt', 'Done'], Obsolete: ['Nicht mehr erforderlich', 'Obsolete']
  };

  /** computed(), not a plain field — the labels must re-translate when the DE/EN toggle flips. */
  readonly statusOptions = computed<ColumnFilterOption[]>(() =>
    (['Draft', 'Active', 'Inactive'] as FolderStatus[])
      .map((s) => ({ value: s, label: this.STATUS_LABEL[s][this.lang.isGerman() ? 0 : 1] })));
  readonly rollupOptions = computed<ColumnFilterOption[]>(() =>
    (['None', 'Pending', 'Overdue', 'Done', 'Obsolete'] as AckStatus[])
      .map((r) => ({ value: r, label: this.ROLLUP_LABEL[r][this.lang.isGerman() ? 0 : 1] })));

  private readonly refreshTick = signal(0);

  /** Which ECAP view(s) back the current tab — Team — active merges 3 views into one list. */
  private readonly viewIds = computed<string[]>(() => {
    switch (this.view()) {
      case 'myActive': return [INFORMATION_FOLDER_VIEW_ID.myActive];
      case 'myDraft': return [INFORMATION_FOLDER_VIEW_ID.myDraft];
      case 'teamActive': return [
        INFORMATION_FOLDER_VIEW_ID.teamsActive,
        INFORMATION_FOLDER_VIEW_ID.teamsDraft,
        INFORMATION_FOLDER_VIEW_ID.teamsInactive
      ];
      case 'inactive': return [INFORMATION_FOLDER_VIEW_ID.myInactive];
      // 'all' and any other value fall through to the same real "All Records" view.
      default: return [INFORMATION_FOLDER_VIEW_ID.allRecords];
    }
  });

  /**
   * Real server-side filter string, built from whichever columns currently have values
   * selected — see FILTER_FIELD's own doc comment for the confirmed ECAP syntax.
   * Confidentiality/status/rollup use a fixed, hardcoded option list, but Name and Responsible
   * team don't — those two need the separate unfiltered optionsAll() fetch below so picking a
   * value in one column doesn't shrink what's selectable in the others.
   */
  private readonly filterQuery = computed(() => {
    const groups: string[] = [];
    const addGroup = (field: string, values: string[]) => {
      if (!values.length) return;
      groups.push('(' + values.map((v) => `${field} equals '${v}'`).join(' OR ') + ')');
    };
    addGroup(FILTER_FIELD.name, this.nameFilter());
    addGroup(FILTER_FIELD.confidentiality, this.confidentialityFilter());
    addGroup(FILTER_FIELD.status, this.statusFilter());
    addGroup(FILTER_FIELD.rollup, this.rollupFilter());
    addGroup(FILTER_FIELD.responsibleTeam, this.responsibleTeamFilter());
    return groups.join(' AND ');
  });

  /** New object references each time (view, filter, or refreshTick changes) so the directive's ngOnChanges refetches. */
  readonly payloads = computed<RecordsPayloadMeta[]>(() => {
    this.refreshTick();
    const filter = this.filterQuery();
    return this.viewIds().map((id) => ({
      id, object_id: OBJECT_ID.informationFolder,
      page: 0, pageSize: 100, sortBy: 'date_modified', sortOrder: 'desc',
      getTotalRecordCount: false, filter
    }));
  });

  /** Same view(s), never filtered — exists only to populate the Name/Responsible team column filter dropdowns' own option lists. */
  readonly optionsPayloads = computed<RecordsPayloadMeta[]>(() => {
    this.refreshTick();
    return this.viewIds().map((id) => ({
      id, object_id: OBJECT_ID.informationFolder,
      page: 0, pageSize: 100, sortBy: 'date_modified', sortOrder: 'desc',
      getTotalRecordCount: false
    }));
  });

  /** One slot per payload; merged into `all` below. Reset whenever the set of payloads changes. */
  private readonly folderPartials = signal<InformationFolder[][]>([]);
  private readonly all = computed(() => this.folderPartials().flat());
  private readonly optionsPartials = signal<InformationFolder[][]>([]);
  private readonly optionsAll = computed(() => this.optionsPartials().flat());
  /** One flag per payload — true once that view has responded (success or error) at least once since the last tab switch. */
  private readonly loaded = signal<boolean[]>([]);
  readonly loading = computed(() => this.loaded().length === 0 || this.loaded().some((l) => !l));

  readonly nameOptions = computed<ColumnFilterOption[]>(() => {
    const names = [...new Set(this.optionsAll().map((f) => f.information_folder_textfield_name).filter(Boolean))].sort();
    return names.map((n) => ({ value: n, label: n }));
  });
  readonly responsibleTeamOptions = computed<ColumnFilterOption[]>(() => {
    const names = [...new Set(this.optionsAll().map((f) => f.responsibleTeamName).filter((n): n is string => !!n))].sort();
    return names.map((n) => ({ value: n, label: n }));
  });

  private readonly emptyRetryCount = signal(0);
  private retryScheduled = false;
  private static readonly MAX_EMPTY_RETRIES = 2;

  onFoldersResponse(index: number, response: RecordsResponseMeta): void {
    const mapped = (response.listData?.recordsList ?? []).map((raw) => this.mapFolder(raw));
    this.folderPartials.update((partials) => {
      const next = [...partials];
      next[index] = mapped;
      return next;
    });
    this.markLoaded(index);
    // ECAP's list endpoint is confirmed flaky elsewhere in this app (identical repeated requests
    // sometimes silently return 0 rows despite real data existing) — a short, bounded retry
    // self-corrects instead of the tab looking permanently empty for a transient hiccup.
    if (mapped.length === 0 && this.emptyRetryCount() < FolderListComponent.MAX_EMPTY_RETRIES) {
      this.scheduleEmptyRetry();
    }
  }

  private scheduleEmptyRetry(): void {
    if (this.retryScheduled) return;
    this.retryScheduled = true;
    setTimeout(() => {
      this.retryScheduled = false;
      this.emptyRetryCount.update((n) => n + 1);
      this.refreshTick.update((n) => n + 1);
    }, 600);
  }

  onFoldersError(index: number, error: HttpErrorResponse): void {
    console.error('Failed to load Information Folder records', error);
    this.folderPartials.update((partials) => {
      const next = [...partials];
      next[index] = [];
      return next;
    });
    this.markLoaded(index);
  }

  onOptionsResponse(index: number, response: RecordsResponseMeta): void {
    const mapped = (response.listData?.recordsList ?? []).map((raw) => this.mapFolder(raw));
    this.optionsPartials.update((partials) => {
      const next = [...partials];
      next[index] = mapped;
      return next;
    });
  }

  onOptionsError(index: number, error: unknown): void {
    console.error('Failed to load Information Folder filter options', error);
    this.optionsPartials.update((partials) => {
      const next = [...partials];
      next[index] = [];
      return next;
    });
  }

  private markLoaded(index: number): void {
    this.loaded.update((flags) => {
      const next = [...flags];
      next[index] = true;
      return next;
    });
  }

  /**
   * Raw record field names should match InformationFolder verbatim once the ECAP views are
   * configured to return them (name/short-name/confidentiality/status/roll-up/deadline/team/
   * created_id) — see the note left for the user about reconfiguring selectedColumnsList.
   */
  private mapFolder(raw: any): InformationFolder {
    return {
      id: raw.id,
      information_folder_textfield_name: raw.information_folder_textfield_name ?? raw.record_locator ?? '',
      information_folder_textfield_short_name: raw.information_folder_textfield_short_name,
      information_folder_richtext_area_user_information: raw.information_folder_richtext_area_user_information ?? '',
      information_folder_textfield_document_category: raw.information_folder_textfield_document_category,
      information_folder_multi_select_picklist_document_language: raw.information_folder_multi_select_picklist_document_language,
      information_folder_picklist_confidentiality_level: raw.information_folder_picklist_confidentiality_level,
      information_folder_picklist_status: raw.information_folder_picklist_status,
      information_folder_picklist_acknowledgment_status: raw.information_folder_picklist_acknowledgment_status,
      information_folder_picklist_processing_status: raw.information_folder_picklist_processing_status,
      information_folder_number_deadlinedays: raw.information_folder_number_deadlinedays,
      // Confirmed live (selectedColumnsList labels this field "Responsible Team"): same {name, id} shape as created_id/modified_id.
      information_folder_lookup_responsible_team: raw.information_folder_lookup_responsible_team?.id ?? raw.information_folder_lookup_responsible_team,
      responsibleTeamName: raw.information_folder_lookup_responsible_team?.name ?? '',
      information_folder_lu_distribution_list: raw.information_folder_lu_distribution_list,
      information_folder_text_field_userid: raw.information_folder_text_field_userid,
      information_folder_text_field_primary_team_id: raw.information_folder_text_field_primary_team_id,
      // "Created By" is a Lookup field on the real layout — comes back as {id, name}, not a plain string.
      created_id: raw.created_id?.id ?? raw.created_id,
      date_created: raw.date_created,
      date_modified: raw.date_modified
    };
  }

  /** Acknowledgement completion, joined by folder name — same real "ALL ACKNOWLEDGEMENTS for CUI" view used on Estate Overview. */
  readonly ackPayload = computed<RecordsPayloadMeta>(() => ({
    id: ACKNOWLEDGEMENT_VIEW_ID.allForCui, object_id: OBJECT_ID.acknowledgement,
    page: 0, pageSize: 200, sortBy: 'date_modified', sortOrder: 'desc', getTotalRecordCount: false
  }));

  private readonly ackStatusesByFolderName = signal<Map<string, AckStatus[]>>(new Map());

  onAcksResponse(response: RecordsResponseMeta): void {
    const byFolder = new Map<string, AckStatus[]>();
    for (const raw of response.listData?.recordsList ?? []) {
      const folderName = raw.acknowledgement_textfield_information_folder_name ?? '';
      const status = (raw.acknowledgment_picklist_status ?? 'None') as AckStatus;
      byFolder.set(folderName, [...(byFolder.get(folderName) ?? []), status]);
    }
    this.ackStatusesByFolderName.set(byFolder);
  }

  onAcksError(error: unknown): void {
    console.error('Failed to load Acknowledgement records', error);
    this.ackStatusesByFolderName.set(new Map());
  }

  stats(folderName: string) {
    return completion(this.ackStatusesByFolderName().get(folderName) ?? []);
  }

  readonly chips = computed<Chip[]>(() => [
    { id: 'myActive', label: this.lang.isGerman() ? 'Meine aktiven' : 'My active' },
    { id: 'myDraft', label: this.lang.isGerman() ? 'Meine Entwürfe' : 'My drafts' },
    { id: 'teamActive', label: this.lang.isGerman() ? 'Team — aktiv' : 'Team — active' },
    { id: 'inactive', label: this.lang.t('inactive') },
    { id: 'all', label: this.lang.isGerman() ? 'Alle' : 'All' }
  ]);

  /**
   * Row security is already enforced server-side by Information_Folder's own access-control
   * rule (its "view"/"record_view" additional_criteria grants exactly: your own records, or
   * your team's, unless you hold an elevated role) — every view including "All" (id '0',
   * ECAP's generic no-view sentinel) is already scoped by that ACL before it reaches here.
   * A client-side re-filter for 'all' used to duplicate this ("mine(f) || team(f) || ...")
   * but broke silently: view '0' doesn't return created_id or the hidden Primary Team Id
   * field at all, so every row read as undefined !== userId and got dropped despite ECAP
   * having already returned exactly the rows this user is allowed to see.
   *
   * Confidentiality/Status/Roll-up are no longer re-filtered here either — payloads() now
   * sends the real filter string to ECAP itself, so `all()` already only contains matching rows.
   */
  readonly visible = computed(() => {
    const search = this.nameSearch().trim().toLowerCase();
    return this.all().filter((f) => !search || f.information_folder_textfield_name.toLowerCase().includes(search));
  });

  deactivate(folderId: string): void {
    this.busy.set(folderId);
    this.actionError.set(null);
    this.http.post<any>(
      `${API_BASE}/record/${OBJECT_ID.informationFolder}/${folderId}/execMacro/${INFORMATION_FOLDER_DEACTIVATE_MACRO_ID}`, { params: {} }
    ).subscribe({
      next: () => { this.busy.set(null); this.refreshTick.update((n) => n + 1); },
      error: (err: HttpErrorResponse) => {
        console.error('Deactivate folder failed', err);
        this.busy.set(null);
        this.actionError.set({
          folderId,
          message: err?.error?.platform?.message?.description ?? (this.lang.isGerman() ? 'Deaktivierung fehlgeschlagen.' : 'Deactivation failed.')
        });
      }
    });
  }

  activate(folderId: string): void {
    this.busy.set(folderId);
    this.actionError.set(null);
    this.http.post<any>(
      `${API_BASE}/record/${OBJECT_ID.informationFolder}/${folderId}/execMacro/${INFORMATION_FOLDER_ACTIVATE_MACRO_ID}`, { params: {} }
    ).subscribe({
      next: () => { this.busy.set(null); this.refreshTick.update((n) => n + 1); },
      error: (err: HttpErrorResponse) => {
        console.error('Activate folder failed', err);
        this.busy.set(null);
        this.actionError.set({
          folderId,
          // execMacro errors nest the real message under platform.message.description — a
          // different shape than the __exception_msg__ format used by other real endpoints.
          message: err?.error?.platform?.message?.description ?? (this.lang.isGerman() ? 'Aktivierung fehlgeschlagen.' : 'Activation failed.')
        });
      }
    });
  }
}
