import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { RecordListDirective, RecordsPayloadMeta, RecordsResponseMeta } from '@escriba/cui-ecap-runtime';
import { catchError, forkJoin, map, of } from 'rxjs';
import { AckStatus } from '@core/models';
import { LanguageService } from '@core/i18n/language.service';
import { ACKNOWLEDGEMENT_VIEW_ID, OBJECT_ID } from '@core/objects';
import { PageSubtitleService } from '@core/services/page-subtitle.service';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { FilterChipsComponent, Chip } from '@shared/ui/filter-chips.component';
import { EmptyStateComponent } from '@shared/ui/empty-state.component';
import { PagerComponent } from '@shared/ui/pager.component';

const ORDER: Record<AckStatus, number> = { Overdue: 0, Pending: 1, Done: 2, Obsolete: 3, None: 4 };
/** A Done row's real date_modified within this window reads as "Just confirmed" rather than a dated timestamp. */
const JUST_CONFIRMED_WINDOW_MS = 10 * 60 * 1000;

interface TaskRow {
  id: string;
  acknowledgment_picklist_status: AckStatus;
  documentVersionLabel: string;
  documentVersionId: string;
  acknowledgement_date_deadline_date: string;
  folderName: string;
  folderId: string;
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
 * The Information Receiver's own "My tasks" list — real ECAP data via the same
 * libEcapRuntimeRecordList + real saved-view mechanism already proven for the compliance
 * chase table (My Pending/My Overdue/My Completed Acknowledgments). The generic
 * rest/record/{oid}?filter=... list endpoint is unreliable for this object regardless of
 * page size (confirmed live); ListDataPage, what this directive calls, is not.
 *
 * Description/category/valid-from are resolved the same way MyDocumentsComponent already
 * does: none of them are on the myPending/myOverdue/myCompleted views themselves, so each is a
 * single-record GET per distinct id (deduped, batched). "Confirmed on"/"Just confirmed" reuses
 * the same real date_modified fetch — within JUST_CONFIRMED_WINDOW_MS of now reads as "Just
 * confirmed" rather than a formatted date, a client-side heuristic since there's no dedicated
 * "date confirmed" field on this object.
 */
@Component({
  selector: 'im-task-list',
  standalone: true,
  imports: [RouterLink, RecordListDirective, StatusBadgeComponent, FilterChipsComponent, EmptyStateComponent, PagerComponent],
  styleUrl: './task-list.component.scss',
  template: `
    @for (payload of payloads(); track $index) {
      <ng-container
        [libEcapRuntimeRecordList]="payload"
        (apiResponseEvent)="onResponse($index, $event)"
        (apiErrorEvent)="onError($index, $event)">
      </ng-container>
    }

    <section class="page">

      <div class="kpis">
        <div class="kpi"><span class="eyebrow">{{ lang.isGerman() ? 'OFFEN' : 'OPEN' }}</span><strong>{{ counts().open }}</strong></div>
        <div class="kpi kpi--danger"><span class="eyebrow">{{ lang.isGerman() ? 'ÜBERFÄLLIG' : 'OVERDUE' }}</span><strong>{{ counts().overdue }}</strong></div>
        <div class="kpi"><span class="eyebrow">{{ lang.isGerman() ? 'ERLEDIGT' : 'DONE' }}</span><strong>{{ counts().done }}</strong></div>
      </div>

      <im-filter-chips [chips]="chips()" [(value)]="filter" />

      <ul class="list">
        @for (a of pagedVisible(); track a.id) {
          <li class="item" [class.item--overdue]="a.acknowledgment_picklist_status === 'Overdue'">
            <div class="item__body">
              <div class="item__meta">
                <im-status-badge [status]="a.acknowledgment_picklist_status" />
                <span class="mono chip">{{ a.documentVersionLabel }}</span>
                @if (a.acknowledgment_picklist_status === 'Done') {
                  <span class="confirmed">{{ confirmedLabel(a) }}</span>
                } @else {
                  <span class="due" [class.due--late]="a.acknowledgment_picklist_status === 'Overdue'">{{ due(a) }}</span>
                }
              </div>
              <h2>{{ a.folderName }}</h2>
              @if (userInformationFor(a.id)) {
                <p [innerHTML]="userInformationFor(a.id)"></p>
              }
              @if (tagLineFor(a)) {
                <span class="tagline">{{ tagLineFor(a) }}</span>
              }
            </div>
            @if (a.acknowledgment_picklist_status === 'Done') {
              <a class="btn btn--outline" [routerLink]="['/tasks', a.id, 'receipt']">
                {{ lang.isGerman() ? 'Quittung ansehen' : 'View receipt' }}
              </a>
            } @else if (a.acknowledgment_picklist_status === 'Obsolete') {
              <a class="btn btn--outline" [routerLink]="['/tasks', a.id]">
                {{ lang.isGerman() ? 'Ansehen' : 'View' }}
              </a>
            } @else {
              <a class="btn" [routerLink]="['/tasks', a.id]">
                {{ lang.isGerman() ? 'Öffnen und bestätigen' : 'Open and confirm' }}
              </a>
            }
          </li>
        } @empty {
          @if (loading()) {
            <im-empty-state [title]="lang.isGerman() ? 'Wird geladen…' : 'Loading…'" />
          } @else {
            <im-empty-state [title]="lang.isGerman() ? 'Nichts zu tun' : 'Nothing to do'"
                            [body]="lang.isGerman() ? 'Sie haben in dieser Ansicht keine offenen Kenntnisnahmen.' : 'You have no outstanding acknowledgements in this view.'" />
          }
        }
      </ul>

      @if (visible().length) {
        <im-pager [total]="visible().length" [(page)]="currentPage" [(pageSize)]="pageSize" />
      }
    </section>
  `
})
export class TaskListComponent {
  private readonly http = inject(HttpClient);
  private readonly pageSubtitle = inject(PageSubtitleService);
  private readonly destroyRef = inject(DestroyRef);
  readonly lang = inject(LanguageService);

  /** Deliberate deviation: the tenant default view is My Completed. */
  readonly filter = signal<string>('pending');

  /** payloads()[index] <-> this map: each single-status chip renders exactly one real ECAP view's own rows, never a merge. */
  private readonly VIEW_INDEX: Record<string, number> = { pending: 0, overdue: 1, done: 2, obsolete: 3 };

  readonly payloads = computed<RecordsPayloadMeta[]>(() => [
    ACKNOWLEDGEMENT_VIEW_ID.myPending, ACKNOWLEDGEMENT_VIEW_ID.myOverdue,
    ACKNOWLEDGEMENT_VIEW_ID.myCompleted, ACKNOWLEDGEMENT_VIEW_ID.myObsolete
  ].map((id) => ({
    id, object_id: OBJECT_ID.acknowledgement,
    page: 0, pageSize: 100, sortBy: 'date_modified', sortOrder: 'desc',
    getTotalRecordCount: false
  })));

  private readonly partials = signal<TaskRow[][]>([]);
  private readonly all = computed(() => this.partials().flat());
  /** One flag per payload — true once that view has responded (success or error) at least once. */
  private readonly loaded = signal<boolean[]>([]);
  readonly loading = computed(() => this.loaded().length === 0 || this.loaded().some((l) => !l));

  readonly pageSize = signal(10);
  readonly currentPage = signal(1);

  constructor() {
    effect(() => {
      const count = this.payloads().length;
      this.partials.set(Array.from({ length: count }, () => []));
      this.loaded.set(Array.from({ length: count }, () => false));
    }, { allowSignalWrites: true });

    effect(() => { this.filter(); this.pageSize(); this.currentPage.set(1); }, { allowSignalWrites: true });

    // Real counts, not static text — the shell topbar shows this in place of its usual static subtitle.
    effect(() => {
      const c = this.counts();
      this.pageSubtitle.set(this.lang.isGerman()
        ? `${c.open} offen · ${c.overdue} überfällig`
        : `${c.open} open · ${c.overdue} overdue`);
    }, { allowSignalWrites: true });
    this.destroyRef.onDestroy(() => this.pageSubtitle.clear());
  }

  onResponse(index: number, response: RecordsResponseMeta): void {
    const mapped = (response.listData?.recordsList ?? []).map((raw: any): TaskRow => ({
      id: raw.id,
      // ListDataPage's real shape: picklists as plain strings, lookups as {name, id} — not the generic REST endpoint's {displayValue, content} shape.
      acknowledgment_picklist_status: (raw.acknowledgment_picklist_status ?? 'None') as AckStatus,
      documentVersionLabel: versionLabelOf(raw.documentversion_record?.name ?? raw.documentversion_record),
      documentVersionId: raw.documentversion_record?.id ?? '',
      acknowledgement_date_deadline_date: raw.acknowledgement_date_deadline_date ?? '',
      folderName: raw.acknowledgement_textfield_information_folder_name ?? raw.acknowledgement_lookup_information_folder?.name ?? '',
      folderId: raw.acknowledgement_lookup_information_folder?.id ?? ''
    }));
    this.partials.update((partials) => {
      const next = [...partials];
      next[index] = mapped;
      return next;
    });
    this.markLoaded(index);
    this.loadAckExtras();
    this.loadFolderCategories();
    this.loadValidFromDates();
  }

  onError(index: number, error: unknown): void {
    console.error('Failed to load my Acknowledgement tasks', error);
    this.partials.update((partials) => {
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

  private readonly userInformationByAckId = signal<Map<string, string>>(new Map());
  private readonly dateModifiedByAckId = signal<Map<string, string>>(new Map());
  private readonly categoryByFolderId = signal<Map<string, string>>(new Map());
  private readonly validFromByVersionId = signal<Map<string, string>>(new Map());

  userInformationFor(ackId: string): string {
    return this.userInformationByAckId().get(ackId) ?? '';
  }

  /** Category, optionally with a real "Valid from" (Document_Version's version_date_time_valid_from) appended — empty string hides the line entirely. */
  tagLineFor(a: TaskRow): string {
    const category = this.categoryByFolderId().get(a.folderId) ?? '';
    const validFrom = this.validFromByVersionId().get(a.documentVersionId);
    const validFromPart = validFrom ? `${this.lang.isGerman() ? 'Gültig ab' : 'Valid from'} ${this.lang.date(validFrom)}` : '';
    return [category, validFromPart].filter(Boolean).join(' · ');
  }

  confirmedLabel(a: TaskRow): string {
    const dateModified = this.dateModifiedByAckId().get(a.id);
    if (!dateModified) return '';
    const isRecent = Date.now() - new Date(dateModified).getTime() < JUST_CONFIRMED_WINDOW_MS;
    if (isRecent) return this.lang.isGerman() ? 'Gerade eben bestätigt' : 'Just confirmed';
    return `${this.lang.isGerman() ? 'Bestätigt am' : 'Confirmed on'} ${this.lang.date(dateModified)}`;
  }

  /**
   * user_information + date_modified aren't on any of the myPending/myOverdue/myCompleted
   * views — same per-id single-record GET pattern MyDocumentsComponent uses for its own extra
   * fields. acknowledgment_richtextarea_user_information is the folder's own "Message to
   * recipients" text (information_folder_richtext_area_user_information), copied onto every
   * acknowledgement ECAP creates — same field ack-detail.component.ts already reads.
   */
  private loadAckExtras(): void {
    const known = this.userInformationByAckId();
    const ids = this.all().map((a) => a.id).filter((id) => id && !known.has(id));
    if (!ids.length) return;

    forkJoin(ids.map((id) =>
      this.http.get<any>(`/networking/rest/record/${OBJECT_ID.acknowledgement}/${id}`, {
        params: { fieldList: 'acknowledgment_richtextarea_user_information,date_modified', alt: 'json' }
      }).pipe(
        map((response) => ({
          id,
          userInformation: response?.platform?.record?.acknowledgment_richtextarea_user_information ?? '',
          dateModified: response?.platform?.record?.date_modified ?? ''
        })),
        catchError((err) => { console.error('Failed to load acknowledgement extras', id, err); return of({ id, userInformation: '', dateModified: '' }); })
      )
    )).subscribe((results) => {
      this.userInformationByAckId.update((map) => {
        const next = new Map(map);
        results.forEach(({ id, userInformation }) => next.set(id, userInformation));
        return next;
      });
      this.dateModifiedByAckId.update((map) => {
        const next = new Map(map);
        results.forEach(({ id, dateModified }) => { if (dateModified) next.set(id, dateModified); });
        return next;
      });
    });
  }

  private loadFolderCategories(): void {
    const known = this.categoryByFolderId();
    const folderIds = [...new Set(this.all().map((a) => a.folderId))].filter((id) => id && !known.has(id));
    if (!folderIds.length) return;

    forkJoin(folderIds.map((folderId) =>
      this.http.get<any>(`/networking/rest/record/${OBJECT_ID.informationFolder}/${folderId}`, {
        params: { fieldList: 'information_folder_textfield_document_category', alt: 'json' }
      }).pipe(
        map((response) => ({ folderId, category: response?.platform?.record?.information_folder_textfield_document_category ?? '' })),
        catchError((err) => { console.error('Failed to load folder category', folderId, err); return of({ folderId, category: '' }); })
      )
    )).subscribe((results) => {
      this.categoryByFolderId.update((map) => {
        const next = new Map(map);
        results.forEach(({ folderId, category }) => next.set(folderId, category));
        return next;
      });
    });
  }

  private loadValidFromDates(): void {
    const known = this.validFromByVersionId();
    const versionIds = [...new Set(this.all().map((a) => a.documentVersionId))].filter((id) => id && !known.has(id));
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
        results.forEach(({ versionId, validFrom }) => { if (validFrom) next.set(versionId, validFrom); });
        return next;
      });
    });
  }

  readonly counts = computed(() => {
    const s = this.all().map((a) => a.acknowledgment_picklist_status);
    return {
      open: s.filter((x) => x === 'Pending' || x === 'Overdue').length,
      overdue: s.filter((x) => x === 'Overdue').length,
      done: s.filter((x) => x === 'Done').length
    };
  });

  readonly chips = computed<Chip[]>(() => [
    { id: 'pending', label: this.lang.t('pending') },
    { id: 'overdue', label: this.lang.t('overdue') },
    { id: 'done', label: this.lang.t('done') },
    { id: 'all', label: this.lang.isGerman() ? 'Alle' : 'All' },
    { id: 'obsolete', label: this.lang.isGerman() ? 'Nicht mehr erforderlich' : 'Obsolete' }
  ]);

  /**
   * Each single-status chip renders exactly its own real ECAP view's rows — payloads()[VIEW_INDEX[f]]
   * — never a client-side re-filter across the other views merged together. "All" is the one
   * deliberate exception: there's no dedicated "My All Acknowledgements" view exposed to this
   * role (unlike Compliance's "ALL ACKNOWLEDGEMENTS for CUI", which shows everyone, not just this
   * user, so it can't be reused here), so "All" unions this user's own 4 real views instead.
   */
  readonly visible = computed(() => {
    const f = this.filter();
    const rows = f === 'all' ? this.all() : (this.partials()[this.VIEW_INDEX[f]] ?? []);
    return rows.slice().sort((a, b) =>
      ORDER[a.acknowledgment_picklist_status] - ORDER[b.acknowledgment_picklist_status] ||
      a.acknowledgement_date_deadline_date.localeCompare(b.acknowledgement_date_deadline_date));
  });

  readonly pagedVisible = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.visible().slice(start, start + this.pageSize());
  });

  due(a: TaskRow): string {
    const de = this.lang.isGerman();
    if (a.acknowledgment_picklist_status === 'Overdue') {
      const n = this.daysOverdue(a.acknowledgement_date_deadline_date);
      return de ? `Seit ${n} Tagen überfällig` : `Overdue by ${n} days`;
    }
    return (de ? 'Frist ' : 'Due ') + this.lang.date(a.acknowledgement_date_deadline_date);
  }

  private daysOverdue(deadline: string, today = new Date()): number {
    const due = new Date(deadline);
    return Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86_400_000));
  }
}
