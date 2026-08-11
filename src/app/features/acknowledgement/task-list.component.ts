import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { RecordListDirective, RecordsPayloadMeta, RecordsResponseMeta } from '@escriba/cui-ecap-runtime';
import { catchError, forkJoin, map, of } from 'rxjs';
import { AckStatus } from '@core/models';
import { LanguageService } from '@core/i18n/language.service';
import { ACKNOWLEDGEMENT_VIEW_ID, OBJECT_ID } from '@core/objects';
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
              @if (descriptionFor(a.id)) {
                <p>{{ descriptionFor(a.id) }}</p>
              }
              @if (tagLineFor(a)) {
                <span class="tagline">{{ tagLineFor(a) }}</span>
              }
            </div>
            @if (a.acknowledgment_picklist_status === 'Done') {
              <a class="btn btn--outline" [routerLink]="['/tasks', a.id, 'receipt']">
                {{ lang.isGerman() ? 'Quittung ansehen' : 'View receipt' }}
              </a>
            } @else {
              <a class="btn" [routerLink]="['/tasks', a.id]">
                {{ lang.isGerman() ? 'Öffnen und bestätigen' : 'Open and confirm' }}
              </a>
            }
          </li>
        } @empty {
          <im-empty-state [title]="lang.isGerman() ? 'Nichts zu tun' : 'Nothing to do'"
                          [body]="lang.isGerman() ? 'Sie haben in dieser Ansicht keine offenen Kenntnisnahmen.' : 'You have no outstanding acknowledgements in this view.'" />
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
  readonly lang = inject(LanguageService);

  /** Deliberate deviation: the tenant default view is My Completed. */
  readonly filter = signal<string>('open');

  readonly payloads = computed<RecordsPayloadMeta[]>(() => [
    ACKNOWLEDGEMENT_VIEW_ID.myPending, ACKNOWLEDGEMENT_VIEW_ID.myOverdue, ACKNOWLEDGEMENT_VIEW_ID.myCompleted
  ].map((id) => ({
    id, object_id: OBJECT_ID.acknowledgement,
    page: 0, pageSize: 100, sortBy: 'date_modified', sortOrder: 'desc',
    getTotalRecordCount: false
  })));

  private readonly partials = signal<TaskRow[][]>([]);
  private readonly all = computed(() => this.partials().flat());

  readonly pageSize = signal(20);
  readonly currentPage = signal(1);

  constructor() {
    effect(() => {
      const count = this.payloads().length;
      this.partials.set(Array.from({ length: count }, () => []));
    }, { allowSignalWrites: true });

    effect(() => { this.filter(); this.pageSize(); this.currentPage.set(1); }, { allowSignalWrites: true });
  }

  onResponse(index: number, response: RecordsResponseMeta): void {
    const mapped = (response.listData?.recordsList ?? []).map((raw: any): TaskRow => ({
      id: raw.id,
      // ListDataPage's real shape: picklists as plain strings, lookups as {name, id} — not the generic REST endpoint's {displayValue, content} shape.
      acknowledgment_picklist_status: (raw.acknowledgment_picklist_status ?? 'None') as AckStatus,
      documentVersionLabel: raw.documentversion_record?.name ?? raw.documentversion_record ?? '',
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
  }

  private readonly descriptionByAckId = signal<Map<string, string>>(new Map());
  private readonly dateModifiedByAckId = signal<Map<string, string>>(new Map());
  private readonly categoryByFolderId = signal<Map<string, string>>(new Map());
  private readonly validFromByVersionId = signal<Map<string, string>>(new Map());

  descriptionFor(ackId: string): string {
    return this.descriptionByAckId().get(ackId) ?? '';
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

  /** description + date_modified aren't on any of the myPending/myOverdue/myCompleted views — same per-id single-record GET pattern MyDocumentsComponent uses for its own extra fields. */
  private loadAckExtras(): void {
    const known = this.descriptionByAckId();
    const ids = this.all().map((a) => a.id).filter((id) => id && !known.has(id));
    if (!ids.length) return;

    forkJoin(ids.map((id) =>
      this.http.get<any>(`/networking/rest/record/${OBJECT_ID.acknowledgement}/${id}`, {
        params: { fieldList: 'description,date_modified', alt: 'json' }
      }).pipe(
        map((response) => ({
          id,
          description: response?.platform?.record?.description ?? '',
          dateModified: response?.platform?.record?.date_modified ?? ''
        })),
        catchError((err) => { console.error('Failed to load acknowledgement extras', id, err); return of({ id, description: '', dateModified: '' }); })
      )
    )).subscribe((results) => {
      this.descriptionByAckId.update((map) => {
        const next = new Map(map);
        results.forEach(({ id, description }) => next.set(id, description));
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
    { id: 'open', label: this.lang.t('pending') },
    { id: 'overdue', label: this.lang.t('overdue') },
    { id: 'done', label: this.lang.t('done') },
    { id: 'all', label: this.lang.isGerman() ? 'Alle' : 'All' }
  ]);

  readonly visible = computed(() => {
    const f = this.filter();
    return this.all()
      .filter((a) => {
        const s = a.acknowledgment_picklist_status;
        if (f === 'all') return true;
        if (f === 'overdue') return s === 'Overdue';
        if (f === 'done') return s === 'Done';
        return s === 'Pending' || s === 'Overdue';
      })
      .sort((a, b) =>
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
