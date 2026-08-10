import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { RecordListDirective, RecordsPayloadMeta, RecordsResponseMeta } from '@escriba/cui-ecap-runtime';
import { catchError, forkJoin, map, of } from 'rxjs';
import { AckStatus } from '@core/models';
import { LanguageService } from '@core/i18n/language.service';
import { ACKNOWLEDGEMENT_VIEW_ID, OBJECT_ID } from '@core/objects';
import { FilterChipsComponent, Chip } from '@shared/ui/filter-chips.component';
import { PagerComponent } from '@shared/ui/pager.component';

interface DocRow {
  ackId: string;
  folderName: string;
  versionLabel: string;
  versionId: string;
  status: AckStatus;
}

/**
 * Saved view "My Assigned Document Versions" — real acknowledgements via the same
 * myPending/myOverdue/myCompleted views already proven in task-list.component.ts, one row per
 * acknowledgement (i.e. per document version this recipient holds), grouped rather than
 * flattened per file — a version with several files lists them together in one row instead of
 * repeating the same version label across separate rows.
 *
 * File names come from the same dmsListPage endpoint already proven in pdf-viewer.component.ts
 * (getTotalRecordCountFlag is required or the platform silently omits childItems) — fetched
 * once per unique version id after the acknowledgement rows load.
 */
@Component({
  selector: 'im-my-documents',
  standalone: true,
  imports: [RouterLink, RecordListDirective, FilterChipsComponent, PagerComponent],
  styles: [`
    .note { background: #fff; border: 1px solid var(--border-1); border-radius: var(--radius-input);
            padding: 12px 16px; font-size: 13px; color: var(--fg-2); margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; background: #fff;
            border: 1px solid var(--border-1); border-radius: var(--radius-card); overflow: hidden; }
    th { text-align: left; font-size: 11px; font-weight: 700; letter-spacing: .08em; color: var(--fg-3);
         background: var(--bg-2); padding: 12px 20px; }
    td { padding: 16px 20px; border-top: 1px solid var(--border-1); font-size: 14px; vertical-align: top; }
    im-filter-chips { display: block; margin-bottom: 16px; }
    .files { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; }
    .empty-cell { color: var(--fg-3); }
    .empty-row { text-align: center; color: var(--fg-3); padding: 24px; }
  `],
  template: `
    @for (payload of payloads(); track $index) {
      <ng-container
        [libEcapRuntimeRecordList]="payload"
        (apiResponseEvent)="onAckResponse($index, $event)"
        (apiErrorEvent)="onAckError($index, $event)">
      </ng-container>
    }

    <p class="note">
      {{ lang.isGerman()
          ? 'Sie sehen ausschließlich Dokumentversionen, für die eine Kenntnisnahme für Sie vorliegt. Datei-Uploads sind für diese Rolle nicht möglich.'
          : 'You only see document versions you hold an acknowledgement for. File uploads are not available for this role.' }}
    </p>

    <im-filter-chips [chips]="chips()" [(value)]="filter" />

    <table>
      <thead><tr>
        <th>{{ lang.t('documents') }}</th><th>{{ lang.t('version') }}</th><th></th>
      </tr></thead>
      <tbody>
        @for (r of pagedRows(); track r.ackId) {
          <tr>
            <td>
              @if (filesFor(r.versionId).length) {
                <ul class="files">
                  @for (name of filesFor(r.versionId); track name) { <li>{{ name }}</li> }
                </ul>
              } @else {
                <span class="empty-cell">{{ lang.isGerman() ? 'Keine Dokumente' : 'No documents' }}</span>
              }
            </td>
            <td class="mono">{{ r.versionLabel }}</td>
            <td><a [routerLink]="['/tasks', r.ackId]">{{ lang.isGerman() ? 'PDF öffnen' : 'Open PDF' }}</a></td>
          </tr>
        } @empty {
          <tr><td colspan="3" class="empty-row">{{ lang.isGerman() ? 'Keine Dokumente zugewiesen.' : 'No documents assigned.' }}</td></tr>
        }
      </tbody>
    </table>
    @if (visibleRows().length) {
      <im-pager [total]="visibleRows().length" [(page)]="currentPage" [(pageSize)]="pageSize" />
    }
  `
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

  private readonly fileNamesByVersionId = signal<Map<string, string[]>>(new Map());

  /** Same three payload slots as task-list.component.ts — index 0/1/2 maps to Pending/Overdue/Completed. */
  private readonly STATUS_BY_INDEX: AckStatus[] = ['Pending', 'Overdue', 'Done'];

  onAckResponse(index: number, response: RecordsResponseMeta): void {
    const status = this.STATUS_BY_INDEX[index];
    const mapped = (response.listData?.recordsList ?? []).map((raw: any): DocRow => ({
      ackId: raw.id,
      folderName: raw.acknowledgement_textfield_information_folder_name ?? '',
      versionLabel: raw.documentversion_record?.name ?? raw.documentversion_record ?? '',
      versionId: raw.documentversion_record?.id ?? '',
      status
    }));
    this.ackPartials.update((partials) => {
      const next = [...partials];
      next[index] = mapped;
      return next;
    });
    this.loadFileNames();
  }

  onAckError(index: number, error: unknown): void {
    console.error('Failed to load my acknowledgements', error);
    this.ackPartials.update((partials) => {
      const next = [...partials];
      next[index] = [];
      return next;
    });
  }

  filesFor(versionId: string): string[] {
    return this.fileNamesByVersionId().get(versionId) ?? [];
  }

  /** 'all' is the default — Documents is a reference page, not an action queue like My acknowledgements. */
  readonly filter = signal('all');

  readonly chips = computed<Chip[]>(() => [
    { id: 'pending', label: this.lang.t('pending') },
    { id: 'overdue', label: this.lang.t('overdue') },
    { id: 'done', label: this.lang.t('done') }
  ]);

  readonly visibleRows = computed(() => {
    const f = this.filter();
    if (f === 'all') return this.rows();
    const status: AckStatus = f === 'pending' ? 'Pending' : f === 'overdue' ? 'Overdue' : 'Done';
    return this.rows().filter((r) => r.status === status);
  });

  readonly pageSize = signal(20);
  readonly currentPage = signal(1);

  readonly pagedRows = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.visibleRows().slice(start, start + this.pageSize());
  });

  constructor() {
    effect(() => { this.filter(); this.pageSize(); this.currentPage.set(1); }, { allowSignalWrites: true });
  }

  /** Fetches each unique version's real file list once rows settle — skips ids already fetched. */
  private loadFileNames(): void {
    const known = this.fileNamesByVersionId();
    const versionIds = [...new Set(this.rows().map((r) => r.versionId))].filter((id) => id && !known.has(id));
    if (!versionIds.length) return;

    forkJoin(versionIds.map((versionId) =>
      this.http.get<any>(`/networking/solution/ServiceDesk/dmsListPage/${OBJECT_ID.documentVersion}/${versionId}`, {
        params: { getFolderChildCountFlag: true, getPathFlag: true, getTotalRecordCountFlag: true, sortBy: 'name', sortOrder: 'asc' }
      }).pipe(
        map((response): string[] => (response?.listData?.folderInfo?.childItems ?? []).map((d: any) => d.name ?? '')),
        map((names) => ({ versionId, names })),
        // One version's failure shouldn't blank out the others — resolve it as "no files" instead.
        catchError((err) => { console.error('Failed to load document file names', versionId, err); return of({ versionId, names: [] as string[] }); })
      )
    )).subscribe((results) => {
      this.fileNamesByVersionId.update((map) => {
        const next = new Map(map);
        results.forEach(({ versionId, names }) => next.set(versionId, names));
        return next;
      });
    });
  }
}
