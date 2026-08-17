import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { RecordListDirective, RecordsPayloadMeta, RecordsResponseMeta } from '@escriba/cui-ecap-runtime';
import { catchError, forkJoin, map, of } from 'rxjs';
import { AckStatus, FolderStatus } from '@core/models';
import { LanguageService } from '@core/i18n/language.service';
import { ACKNOWLEDGEMENT_VIEW_ID, OBJECT_ID } from '@core/objects';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { PagerComponent } from '@shared/ui/pager.component';
import { ColumnFilterComponent, ColumnFilterOption } from '@shared/ui/column-filter.component';

interface DocRow {
  ackId: string;
  folderName: string;
  folderId: string;
  versionLabel: string;
  versionId: string;
  status: AckStatus;
}

/**
 * documentversion_record's name/displayValue is the full record_locator ("{folder name} -
 * {version}") — only the part after the last " - " is the version itself, same parsing already
 * proven for this shape in version-timeline.component.ts.
 */
function versionLabelOf(displayValue: string | undefined): string {
  return (displayValue ?? '').split(' - ').pop() || '';
}

/**
 * Saved view "My Assigned Document Versions" — real acknowledgements via the same
 * myPending/myOverdue/myCompleted views already proven in task-list.component.ts, one row per
 * acknowledgement (i.e. per document version this recipient holds).
 *
 * "Valid from" and "Status" shown here are NOT on the Acknowledgement object at all — neither
 * of the myPending/myOverdue/myCompleted views exposes them. "Valid from" is the real
 * version_date_time_valid_from field on Document_Version; "Status" is the folder's own
 * information_folder_picklist_status (Draft/Active/Inactive) — a completely different field
 * from the acknowledgement's own Pending/Overdue/Done status. Both are resolved with one
 * single-record GET per distinct id (deduped, one forkJoin batch each), same
 * per-item-catchError pattern already proven for file names below.
 */
@Component({
  selector: 'im-my-documents',
  standalone: true,
  imports: [RouterLink, RecordListDirective, StatusBadgeComponent, PagerComponent, ColumnFilterComponent],
  templateUrl: './my-documents.component.html',
  styleUrl: './my-documents.component.scss'
})
export class MyDocumentsComponent {
  private readonly http = inject(HttpClient);
  readonly lang = inject(LanguageService);

  readonly payloads = computed<RecordsPayloadMeta[]>(() => [
    ACKNOWLEDGEMENT_VIEW_ID.myPending, ACKNOWLEDGEMENT_VIEW_ID.myOverdue, ACKNOWLEDGEMENT_VIEW_ID.myCompleted
  ].map((id) => ({
    id, object_id: OBJECT_ID.acknowledgement,
    page: 0, pageSize: 100, sortBy: 'date_modified', sortOrder: 'desc',
    getTotalRecordCount: false
  })));

  private readonly ackPartials = signal<DocRow[][]>([[], [], []]);
  readonly rows = computed(() => this.ackPartials().flat());
  /** One flag per payload — true once that view has responded (success or error) at least once. */
  private readonly loaded = signal<boolean[]>([false, false, false]);
  readonly loading = computed(() => this.loaded().some((l) => !l));

  private readonly validFromByVersionId = signal<Map<string, string>>(new Map());
  private readonly folderStatusByFolderId = signal<Map<string, FolderStatus>>(new Map());

  /** Same three payload slots as task-list.component.ts — index 0/1/2 maps to Pending/Overdue/Completed. */
  private readonly STATUS_BY_INDEX: AckStatus[] = ['Pending', 'Overdue', 'Done'];

  onAckResponse(index: number, response: RecordsResponseMeta): void {
    const status = this.STATUS_BY_INDEX[index];
    const mapped = (response.listData?.recordsList ?? []).map((raw: any): DocRow => ({
      ackId: raw.id,
      folderName: raw.acknowledgement_textfield_information_folder_name ?? raw.acknowledgement_lookup_information_folder?.name ?? '',
      folderId: raw.acknowledgement_lookup_information_folder?.id ?? '',
      versionLabel: versionLabelOf(raw.documentversion_record?.name ?? raw.documentversion_record),
      versionId: raw.documentversion_record?.id ?? '',
      status
    }));
    this.ackPartials.update((partials) => {
      const next = [...partials];
      next[index] = mapped;
      return next;
    });
    this.markLoaded(index);
    this.loadValidFromDates();
    this.loadFolderStatuses();
  }

  onAckError(index: number, error: unknown): void {
    console.error('Failed to load my acknowledgements', error);
    this.ackPartials.update((partials) => {
      const next = [...partials];
      next[index] = [];
      return next;
    });
    this.markLoaded(index);
  }

  private markLoaded(index: number): void {
    this.loaded.update((flags) => {
      const next = [...flags];
      next[index] = true;
      return next;
    });
  }

  validFromFor(versionId: string): string | null {
    return this.validFromByVersionId().get(versionId) ?? null;
  }

  folderStatusFor(folderId: string): FolderStatus | null {
    return this.folderStatusByFolderId().get(folderId) ?? null;
  }

  /** Empty array means "no filter" — every row matches, same convention as im-column-filter's own contract. */
  readonly documentColumnFilter = signal<string[]>([]);
  readonly versionColumnFilter = signal<string[]>([]);
  readonly validFromColumnFilter = signal<string[]>([]);
  readonly statusColumnFilter = signal<string[]>([]);
  /** Free-text document name search — separate from the Document column filter dropdown above. Client-side, so no debounce needed — this is a plain array filter, not a network request. */
  readonly nameSearch = signal('');

  /** Column filter option lists are derived from whatever's actually loaded, not a hardcoded tenant-wide list. */
  readonly documentOptions = computed<ColumnFilterOption[]>(() => {
    const names = [...new Set(this.rows().map((r) => r.folderName).filter(Boolean))].sort();
    return names.map((n) => ({ value: n, label: n }));
  });
  readonly versionOptions = computed<ColumnFilterOption[]>(() => {
    const versions = [...new Set(this.rows().map((r) => r.versionLabel).filter(Boolean))].sort();
    return versions.map((v) => ({ value: v, label: v }));
  });
  readonly validFromOptions = computed<ColumnFilterOption[]>(() => {
    const dates = [...new Set(this.rows()
      .map((r) => this.validFromFor(r.versionId))
      .filter((d): d is string => !!d)
      .map((d) => this.lang.date(d)))].sort();
    return dates.map((d) => ({ value: d, label: d }));
  });
  private readonly FOLDER_STATUS_KEY: Record<FolderStatus, 'draft' | 'active' | 'inactive'> = {
    Draft: 'draft', Active: 'active', Inactive: 'inactive'
  };
  readonly statusOptions = computed<ColumnFilterOption[]>(() =>
    (['Active', 'Draft', 'Inactive'] as FolderStatus[])
      .map((s) => ({ value: s, label: this.lang.t(this.FOLDER_STATUS_KEY[s]) })));

  readonly filteredRows = computed(() => {
    const documentCol = this.documentColumnFilter();
    const versionCol = this.versionColumnFilter();
    const validFromCol = this.validFromColumnFilter();
    const statusCol = this.statusColumnFilter();
    const search = this.nameSearch().trim().toLowerCase();
    return this.rows()
      .filter((r) => !search || r.folderName.toLowerCase().includes(search))
      .filter((r) => !documentCol.length || documentCol.includes(r.folderName))
      .filter((r) => !versionCol.length || versionCol.includes(r.versionLabel))
      .filter((r) => {
        if (!validFromCol.length) return true;
        const validFrom = this.validFromFor(r.versionId);
        return validFrom ? validFromCol.includes(this.lang.date(validFrom)) : false;
      })
      .filter((r) => {
        if (!statusCol.length) return true;
        const status = this.folderStatusFor(r.folderId);
        return status ? statusCol.includes(status) : false;
      });
  });

  readonly pageSize = signal(10);
  readonly currentPage = signal(1);

  readonly pagedRows = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.filteredRows().slice(start, start + this.pageSize());
  });

  constructor() {
    effect(() => {
      this.pageSize(); this.documentColumnFilter(); this.versionColumnFilter();
      this.validFromColumnFilter(); this.statusColumnFilter(); this.nameSearch();
      this.currentPage.set(1);
    }, { allowSignalWrites: true });
  }

  /** Fetches each unique version's real "valid from" date once rows settle — skips ids already fetched. */
  private loadValidFromDates(): void {
    const known = this.validFromByVersionId();
    const versionIds = [...new Set(this.rows().map((r) => r.versionId))].filter((id) => id && !known.has(id));
    if (!versionIds.length) return;

    forkJoin(versionIds.map((versionId) =>
      this.http.get<any>(`/networking/rest/record/${OBJECT_ID.documentVersion}/${versionId}`, {
        params: { fieldList: 'version_date_time_valid_from', alt: 'json' }
      }).pipe(
        map((response) => ({ versionId, validFrom: response?.platform?.record?.version_date_time_valid_from ?? '' })),
        catchError((err) => { console.error('Failed to load version valid-from date', versionId, err); return of({ versionId, validFrom: '' }); })
      )
    )).subscribe((results) => {
      this.validFromByVersionId.update((map) => {
        const next = new Map(map);
        results.forEach(({ versionId, validFrom }) => next.set(versionId, validFrom));
        return next;
      });
    });
  }

  /** Fetches each unique folder's real status once rows settle — skips ids already fetched. */
  private loadFolderStatuses(): void {
    const known = this.folderStatusByFolderId();
    const folderIds = [...new Set(this.rows().map((r) => r.folderId))].filter((id) => id && !known.has(id));
    if (!folderIds.length) return;

    forkJoin(folderIds.map((folderId) =>
      this.http.get<any>(`/networking/rest/record/${OBJECT_ID.informationFolder}/${folderId}`, {
        params: { fieldList: 'information_folder_picklist_status', alt: 'json' }
      }).pipe(
        // Picklist fields come back as {displayValue, content} objects from this single-record endpoint, not plain strings.
        map((response) => ({ folderId, status: (response?.platform?.record?.information_folder_picklist_status?.content ?? null) as FolderStatus | null })),
        catchError((err) => { console.error('Failed to load folder status', folderId, err); return of({ folderId, status: null as FolderStatus | null }); })
      )
    )).subscribe((results) => {
      this.folderStatusByFolderId.update((map) => {
        const next = new Map(map);
        results.forEach(({ folderId, status }) => { if (status) next.set(folderId, status); });
        return next;
      });
    });
  }
}
