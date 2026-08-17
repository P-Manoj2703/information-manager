import { Component, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { RecordListDirective, RecordsPayloadMeta, RecordsResponseMeta } from '@escriba/cui-ecap-runtime';
import { Acknowledgement, AckStatus } from '@core/models';
import { SessionService } from '@core/services/session.service';
import { AcknowledgementService } from '@core/services/acknowledgement.service';
import { LanguageService } from '@core/i18n/language.service';
import { ACKNOWLEDGEMENT_VIEW_ID, OBJECT_ID } from '@core/objects';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { FilterChipsComponent, Chip } from '@shared/ui/filter-chips.component';
import { ColumnFilterComponent, ColumnFilterOption } from '@shared/ui/column-filter.component';
import { PagerComponent } from '@shared/ui/pager.component';

/**
 * documentversion_record's name/displayValue is the full record_locator ("{folder name} -
 * {version}") — only the part after the last " - " is the version itself, same parsing already
 * proven for this shape elsewhere (ack-detail.component.ts, task-list.component.ts, etc.).
 */
function versionLabelOf(displayValue: string | undefined): string {
  return (displayValue ?? '').split(' - ').pop() || '';
}

/**
 * Real ECAP field names for server-side filtering, confirmed live via network capture
 * (2026-08-14) against ListDataPage's own `filter` query param:
 * (field equals 'v1' OR field equals 'v2') AND (field2 equals 'v3'). Folder uses the plain
 * text mirror field (high confidence, same as Monitoring's own folder filter); status is a
 * confirmed picklist pattern. documentversion_record is an object/lookup field — filtering by
 * its display value is a best-effort extension of the pattern, not directly tested.
 */
const FILTER_FIELD = {
  employee: 'acknowledgment_textfield_employee',
  folder: 'acknowledgement_textfield_information_folder_name',
  version: 'documentversion_record',
  status: 'acknowledgment_picklist_status',
  deadline: 'acknowledgement_date_deadline_date'
} as const;

/** documentVersionRaw is documentversion_record's own real value (the full record_locator) — needed to filter server-side, since the display field is already stripped down to the short version by mapAck(). */
interface AckRow extends Acknowledgement { documentVersionRaw: string; }

/**
 * UC-IP-06 / UC-CMP-03. Person-level chase across folders.
 *
 * Real data via libEcapRuntimeRecordList against Acknowledgement's own saved views — the
 * generic rest/record/{oid}?filter=... list endpoint proved unreliable for this object
 * (deterministic 0-row responses despite a correct totalRecordCount, at every page size
 * tried live), the same failure mode already worked around elsewhere in this app. ListDataPage
 * (what this directive calls) reliably returned real rows on every attempt instead.
 *
 * Each chip maps to one of ECAP's own real views rather than a client-side status filter, so
 * "My User Acknowledgments" is genuinely ECAP's "Acknowledgments Assigned to Users" view, and
 * "All" is the real "ALL ACKNOWLEDGEMENTS for CUI" view built specifically for this app
 * (confirmed via live network capture) — unlike the object's generic '0' view (used for the
 * same purpose on the folder list), which only returns id/record_locator and no real columns.
 * Row visibility on every chip is still enforced server-side by the object's own ACL, so
 * Compliance sees everything through "All" while other roles only see their own scoped subset.
 */
@Component({
  selector: 'im-chase-table',
  standalone: true,
  imports: [RouterLink, RecordListDirective, StatusBadgeComponent, FilterChipsComponent, ColumnFilterComponent, PagerComponent],
  templateUrl: './chase-table.component.html',
  styleUrl: './chase-table.component.scss'
})
export class ChaseTableComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly session = inject(SessionService);
  readonly acks = inject(AcknowledgementService);
  readonly lang = inject(LanguageService);

  /** Compliance's real ACL sees every record, so "All" is the more useful landing chip for them. */
  readonly filter = signal(this.session.role() === 'complianceverantwortlicher' ? 'all' : 'overdue');

  /**
   * Arriving from a folder's own page (e.g. Estate Overview) via ?folder=<name>: real folder
   * names are unique in this tenant, so a plain equality match is reliable without needing the
   * folder's id. Forces the "All" chip too, since the folder's acknowledgements can be in any
   * status — a status-scoped chip would silently hide most of them.
   */
  private readonly queryParams = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  readonly folderFilter = computed(() => this.queryParams().get('folder') ?? '');

  /**
   * Which real ECAP view backs the current chip. Compliance gets its own dedicated
   * Pending/Overdue/Completed views here — tenant-wide oversight views, not the "my own
   * acknowledgements" views Information Provider uses for the same three chips.
   */
  private readonly viewIds = computed<string[]>(() => {
    const isCompliance = this.session.role() === 'complianceverantwortlicher';
    switch (this.filter()) {
      case 'overdue': return [isCompliance ? ACKNOWLEDGEMENT_VIEW_ID.complianceOverdue : ACKNOWLEDGEMENT_VIEW_ID.myOverdue];
      case 'pending': return [isCompliance ? ACKNOWLEDGEMENT_VIEW_ID.compliancePending : ACKNOWLEDGEMENT_VIEW_ID.myPending];
      case 'done': return [isCompliance ? ACKNOWLEDGEMENT_VIEW_ID.complianceCompleted : ACKNOWLEDGEMENT_VIEW_ID.myCompleted];
      case 'myUser': return [ACKNOWLEDGEMENT_VIEW_ID.assignedToUsers];
      case 'all': return [ACKNOWLEDGEMENT_VIEW_ID.allForCui];
      default: return [];
    }
  });

  /**
   * Real server-side filter string, built from whichever columns currently have values
   * selected — see FILTER_FIELD's own doc comment for the confirmed ECAP syntax. The folder
   * deep-link (folderFilter) shares the same field as the Information folder column filter, so
   * its value is folded into that same OR-group rather than a separate AND-block.
   */
  private readonly filterQuery = computed(() => {
    const groups: string[] = [];
    const addGroup = (field: string, values: string[]) => {
      const unique = [...new Set(values.filter(Boolean))];
      if (!unique.length) return;
      groups.push('(' + unique.map((v) => `${field} equals '${v}'`).join(' OR ') + ')');
    };
    addGroup(FILTER_FIELD.employee, this.employeeColumnFilter());
    addGroup(FILTER_FIELD.folder, [...this.folderColumnFilter(), ...(this.folderFilter() ? [this.folderFilter()] : [])]);
    addGroup(FILTER_FIELD.version, this.versionColumnFilter());
    addGroup(FILTER_FIELD.status, this.statusColumnFilter());
    addGroup(FILTER_FIELD.deadline, this.deadlineColumnFilter());
    return groups.join(' AND ');
  });

  readonly payloads = computed<RecordsPayloadMeta[]>(() => {
    const filter = this.filterQuery();
    return this.viewIds().map((id) => ({
      id, object_id: OBJECT_ID.acknowledgement,
      page: 0, pageSize: 100, sortBy: 'date_modified', sortOrder: 'desc',
      getTotalRecordCount: false, filter
    }));
  });

  /** Same view(s), never filtered — exists only to populate the column filter dropdowns' own option lists. */
  readonly optionsPayloads = computed<RecordsPayloadMeta[]>(() =>
    this.viewIds().map((id) => ({
      id, object_id: OBJECT_ID.acknowledgement,
      page: 0, pageSize: 100, sortBy: 'date_modified', sortOrder: 'desc',
      getTotalRecordCount: false
    })));

  private readonly ackPartials = signal<AckRow[][]>([]);
  private readonly all = computed(() => this.ackPartials().flat());
  private readonly optionsPartials = signal<AckRow[][]>([]);
  private readonly optionsAll = computed(() => this.optionsPartials().flat());
  /** One flag per payload — true once that view has responded (success or error) at least once since the last chip switch. */
  private readonly loaded = signal<boolean[]>([]);
  readonly loading = computed(() => this.loaded().length === 0 || this.loaded().some((l) => !l));

  readonly pageSize = signal(10);
  readonly currentPage = signal(1);

  constructor() {
    effect(() => {
      const count = this.viewIds().length;
      this.ackPartials.set(Array.from({ length: count }, () => []));
      this.optionsPartials.set(Array.from({ length: count }, () => []));
      this.loaded.set(Array.from({ length: count }, () => false));
    }, { allowSignalWrites: true });

    // A folder deep-link needs every one of that folder's acknowledgements regardless of
    // status, not whichever single-status chip happened to be selected before arriving.
    effect(() => {
      if (this.folderFilter()) this.filter.set('all');
    }, { allowSignalWrites: true });

    // The role switcher (dev/test only) can flip to Compliance while "My User Acknowledgments"
    // is still selected — that chip no longer renders for this role, so land on "All" instead
    // of silently keeping a filter the user can no longer see or reselect.
    effect(() => {
      if (this.session.role() === 'complianceverantwortlicher' && this.filter() === 'myUser') this.filter.set('all');
    }, { allowSignalWrites: true });

    // Switching chips/page size can shrink or reorder the set — land back on page 1 so the
    // pager never gets stuck past the new last page.
    effect(() => {
      this.filter(); this.pageSize(); this.folderFilter();
      this.employeeColumnFilter(); this.folderColumnFilter(); this.versionColumnFilter();
      this.statusColumnFilter(); this.deadlineColumnFilter(); this.nameSearch();
      this.currentPage.set(1);
    }, { allowSignalWrites: true });
  }

  clearFolderFilter(): void {
    this.router.navigate([], { queryParams: {} });
  }

  onAckResponse(index: number, response: RecordsResponseMeta): void {
    const mapped = (response.listData?.recordsList ?? []).map((raw) => this.mapAck(raw));
    this.ackPartials.update((partials) => {
      const next = [...partials];
      next[index] = mapped;
      return next;
    });
    this.markLoaded(index);
  }

  onAckError(index: number, error: unknown): void {
    console.error('Failed to load Acknowledgement records', error);
    this.ackPartials.update((partials) => {
      const next = [...partials];
      next[index] = [];
      return next;
    });
    this.markLoaded(index);
  }

  onOptionsResponse(index: number, response: RecordsResponseMeta): void {
    const mapped = (response.listData?.recordsList ?? []).map((raw) => this.mapAck(raw));
    this.optionsPartials.update((partials) => {
      const next = [...partials];
      next[index] = mapped;
      return next;
    });
  }

  onOptionsError(index: number, error: unknown): void {
    console.error('Failed to load Acknowledgement filter options', error);
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
   * ListDataPage's real shape (confirmed live): picklists come back as plain strings, lookups
   * as {name, id} — not the generic REST endpoint's {displayValue, content} shape. Not every
   * view configures the same columns — email and the user id aren't part of the "My..." views,
   * but "ALL ACKNOWLEDGEMENTS for CUI" does expose email, so it's read when present rather than
   * guessed on views that don't have it.
   */
  private mapAck(raw: any): AckRow {
    return {
      id: raw.id,
      acknowledgment_picklist_status: (raw.acknowledgment_picklist_status ?? 'None') as AckStatus,
      acknowledgment_textfield_employee: raw.acknowledgment_textfield_employee ?? '',
      acknowledgement_lookup_user: raw.owner_id?.id ?? '',
      acknowledgment_email_address_email: raw.acknowledgment_email_address_email ?? '',
      acknowledgement_lookup_information_folder: raw.acknowledgement_lookup_information_folder?.id ?? '',
      acknowledgement_textfield_information_folder_name:
        raw.acknowledgement_textfield_information_folder_name ?? raw.acknowledgement_lookup_information_folder?.name ?? '',
      documentversion_record: versionLabelOf(raw.documentversion_record?.name ?? raw.documentversion_record),
      documentVersionRaw: raw.documentversion_record?.name ?? raw.documentversion_record ?? '',
      acknowledgement_date_deadline_date: raw.acknowledgement_date_deadline_date ?? '',
      acknowledgment_richtextarea_user_information: ''
    };
  }

  /** "My User Acknowledgments" is Information Provider's own scoped view — Compliance already sees everything via "All", so the chip doesn't apply to that role. */
  readonly chips = computed<Chip[]>(() => [
    { id: 'overdue', label: this.lang.t('overdue') },
    { id: 'pending', label: this.lang.t('pending') },
    { id: 'done', label: this.lang.t('done') },
    { id: 'all', label: this.lang.isGerman() ? 'Alle' : 'All' },
    ...(this.session.role() === 'complianceverantwortlicher'
      ? []
      : [{ id: 'myUser', label: this.lang.isGerman() ? 'Meine Benutzer-Kenntnisnahmen' : 'Acknowledgments Assigned to Users' }])
  ]);

  /** Empty array means "no filter" — every row matches, same convention as im-column-filter's own contract. */
  readonly employeeColumnFilter = signal<string[]>([]);
  readonly folderColumnFilter = signal<string[]>([]);
  readonly versionColumnFilter = signal<string[]>([]);
  readonly statusColumnFilter = signal<string[]>([]);
  readonly deadlineColumnFilter = signal<string[]>([]);
  /**
   * Free-text folder name search — separate from the Information folder column filter dropdown
   * above. Applied client-side (see `rows` below) against whatever's already loaded for the
   * current chip, not sent to ECAP as a `filter` condition — a `contains`-style operator was
   * tried there first but didn't behave as expected, so this searches the already-fetched rows
   * instead of guessing at unconfirmed ECAP filter syntax a second time.
   */
  readonly nameSearch = signal('');

  /** Drives the single "Reset filters" link — shown only while at least one column filter is active. */
  readonly anyColumnFilterActive = computed(() =>
    !!(this.employeeColumnFilter().length || this.folderColumnFilter().length || this.versionColumnFilter().length
      || this.statusColumnFilter().length || this.deadlineColumnFilter().length || this.nameSearch().trim()));

  resetAllColumnFilters(): void {
    this.employeeColumnFilter.set([]);
    this.folderColumnFilter.set([]);
    this.versionColumnFilter.set([]);
    this.statusColumnFilter.set([]);
    this.deadlineColumnFilter.set([]);
    this.nameSearch.set('');
  }

  /**
   * Column filter option lists are derived from the unfiltered optionsAll(), not the
   * server-filtered all() — otherwise picking a value in one column would shrink what's
   * selectable in the others, since all() only reflects whatever's currently matched.
   */
  readonly employeeOptions = computed<ColumnFilterOption[]>(() => {
    const names = [...new Set(this.optionsAll().map((a) => a.acknowledgment_textfield_employee).filter(Boolean))].sort();
    return names.map((n) => ({ value: n, label: n }));
  });
  readonly folderOptions = computed<ColumnFilterOption[]>(() => {
    const names = [...new Set(this.optionsAll().map((a) => a.acknowledgement_textfield_information_folder_name).filter(Boolean))].sort();
    return names.map((n) => ({ value: n, label: n }));
  });
  /** value is the real documentversion_record value (record_locator) — the field ECAP actually filters on — label is the short version shown everywhere else. */
  readonly versionOptions = computed<ColumnFilterOption[]>(() => {
    const byRaw = new Map<string, string>();
    this.optionsAll().forEach((a) => { if (a.documentVersionRaw) byRaw.set(a.documentVersionRaw, a.documentversion_record); });
    return [...byRaw.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([raw, label]) => ({ value: raw, label }));
  });
  private readonly STATUS_LABEL: Record<AckStatus, [string, string]> = {
    None: ['Keine', 'None'], Pending: ['Offen', 'Pending'], Overdue: ['Überfällig', 'Overdue'],
    Done: ['Erledigt', 'Done'], Obsolete: ['Nicht mehr erforderlich', 'Obsolete']
  };
  readonly statusOptions = computed<ColumnFilterOption[]>(() =>
    (['Overdue', 'Pending', 'Done', 'Obsolete', 'None'] as AckStatus[])
      .map((s) => ({ value: s, label: this.STATUS_LABEL[s][this.lang.isGerman() ? 0 : 1] })));
  readonly deadlineOptions = computed<ColumnFilterOption[]>(() => {
    const deadlines = [...new Set(this.optionsAll().map((a) => a.acknowledgement_date_deadline_date).filter(Boolean))].sort();
    return deadlines.map((d) => ({ value: d, label: d }));
  });

  /**
   * Folder/version/status/deadline column filtering (and the folder deep-link) all happen
   * server-side via filterQuery() — all() already only contains matching rows. The free-text
   * name search is layered on top client-side (see nameSearch's own doc comment).
   */
  readonly rows = computed(() => {
    const search = this.nameSearch().trim().toLowerCase();
    return this.all().filter((a) => !search || a.acknowledgement_textfield_information_folder_name.toLowerCase().includes(search));
  });

  readonly pagedRows = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.rows().slice(start, start + this.pageSize());
  });

  initials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
  }

  exportCsv(): void {
    const head = ['employee', 'folder', 'version', 'deadline', 'status'].join(';');
    const body = this.rows().map((a) => [
      a.acknowledgment_textfield_employee,
      a.acknowledgement_textfield_information_folder_name, a.documentversion_record,
      a.acknowledgement_date_deadline_date, a.acknowledgment_picklist_status
    ].join(';'));
    const url = URL.createObjectURL(new Blob([[head, ...body].join('\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'acknowledgements.csv'; link.click();
    URL.revokeObjectURL(url);
  }
}
