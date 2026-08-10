import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RecordListDirective, RecordsPayloadMeta, RecordsResponseMeta } from '@escriba/cui-ecap-runtime';
import { AckStatus } from '@core/models';
import { LanguageService } from '@core/i18n/language.service';
import { ACKNOWLEDGEMENT_VIEW_ID, OBJECT_ID } from '@core/objects';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { FilterChipsComponent, Chip } from '@shared/ui/filter-chips.component';
import { EmptyStateComponent } from '@shared/ui/empty-state.component';
import { PagerComponent } from '@shared/ui/pager.component';

const ORDER: Record<AckStatus, number> = { Overdue: 0, Pending: 1, Done: 2, Obsolete: 3, None: 4 };

interface TaskRow {
  id: string;
  acknowledgment_picklist_status: AckStatus;
  documentVersionLabel: string;
  acknowledgement_date_deadline_date: string;
  folderName: string;
}

/**
 * The Information Receiver's own "My tasks" list — real ECAP data via the same
 * libEcapRuntimeRecordList + real saved-view mechanism already proven for the compliance
 * chase table (My Pending/My Overdue/My Completed Acknowledgments). The generic
 * rest/record/{oid}?filter=... list endpoint is unreliable for this object regardless of
 * page size (confirmed live); ListDataPage, what this directive calls, is not.
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
                <span class="due" [class.due--late]="a.acknowledgment_picklist_status === 'Overdue'">{{ due(a) }}</span>
              </div>
              <h2>{{ a.folderName }}</h2>
            </div>
            <a class="btn" [routerLink]="['/tasks', a.id]">
              {{ lang.isGerman() ? 'Öffnen und bestätigen' : 'Open and confirm' }}
            </a>
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
      acknowledgement_date_deadline_date: raw.acknowledgement_date_deadline_date ?? '',
      folderName: raw.acknowledgement_textfield_information_folder_name ?? raw.acknowledgement_lookup_information_folder?.name ?? ''
    }));
    this.partials.update((partials) => {
      const next = [...partials];
      next[index] = mapped;
      return next;
    });
  }

  onError(index: number, error: unknown): void {
    console.error('Failed to load my Acknowledgement tasks', error);
    this.partials.update((partials) => {
      const next = [...partials];
      next[index] = [];
      return next;
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

  /** Only the 3 categories recipients care about: Open/Pending, Overdue, Done. No "All", no Obsolete/None. */
  readonly chips = computed<Chip[]>(() => [
    { id: 'open', label: this.lang.t('pending') },
    { id: 'overdue', label: this.lang.t('overdue') },
    { id: 'done', label: this.lang.t('done') }
  ]);

  readonly visible = computed(() => {
    const f = this.filter();
    return this.all()
      .filter((a) => {
        const s = a.acknowledgment_picklist_status;
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
