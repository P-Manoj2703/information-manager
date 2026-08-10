import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RecordListDirective, RecordsPayloadMeta, RecordsResponseMeta } from '@escriba/cui-ecap-runtime';
import { AckStatus } from '@core/models';
import { completion } from '@core/rollup';
import { LanguageService } from '@core/i18n/language.service';
import { ACKNOWLEDGEMENT_VIEW_ID, INFORMATION_FOLDER_VIEW_ID, OBJECT_ID } from '@core/objects';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { CompletionBarComponent } from '@shared/ui/completion-bar.component';

interface FolderTile {
  id: string;
  name: string;
  confidentiality: string;
  acknowledgmentStatus: AckStatus;
}

const BUCKET_STATUSES: AckStatus[] = ['None', 'Pending', 'Overdue', 'Done', 'Obsolete'];

/**
 * UC-CMP-01 — portfolio view; Compliance's real ACL sees every folder regardless of owner
 * (confirmed via object_properties: Information_Folder's view/record_view criteria include
 * the Complianceverantwortlicher role unconditionally). Real folder list via
 * INFORMATION_FOLDER_VIEW_ID.allRecords — a dedicated "All Records" view distinct from the
 * object's generic (and useless) id-'0' sentinel, confirmed live to return real columns
 * including the folder name (exposed here as record_locator, not a separate name field) and
 * its own acknowledgment/confidentiality picklists.
 *
 * Completion stats reuse the same "ALL ACKNOWLEDGEMENTS for CUI" view already proven for
 * Monitoring/chase-table, joined to folders by name — that view exposes the folder's name
 * (acknowledgement_textfield_information_folder_name) but not its id, and folder names are
 * unique in this tenant, so the join is reliable without an extra per-folder request.
 *
 * Status buckets cover all five real values (None/Pending/Overdue/Done/Obsolete) as a
 * client-side grouping of this same real folder list by its own acknowledgment_status field,
 * filtering the grid below in place — not a separate ECAP view per bucket, and not a
 * navigation away from this page.
 */
@Component({
  selector: 'im-estate-overview',
  standalone: true,
  imports: [RouterLink, RecordListDirective, StatusBadgeComponent, CompletionBarComponent],
  styles: [`
    .buckets { display:flex; gap:10px; margin-bottom:20px; flex-wrap:wrap; }
    .bucket { display:flex; align-items:center; gap:10px; background:#fff; border:1px solid var(--border-1);
              border-radius:var(--radius-pill); padding:9px 18px 9px 8px; cursor:pointer; font:inherit;
              transition:border-color 120ms ease;
              &.on { border-color:var(--navy-900); background:var(--navy-900); }
              &.on .count, &.on .label { color:#fff; } }
    .bucket .count { font-size:15px; font-weight:700; }
    .bucket .label { font-size:13px; color:var(--fg-2); }
    .clear { border:0; background:none; color:var(--fg-3); cursor:pointer; font:inherit; font-size:13px;
             text-decoration:underline; padding:9px 4px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:16px; }
    .tile { background:#fff; border:1px solid var(--border-1); border-radius:var(--radius-card);
            padding:20px 22px; display:flex; flex-direction:column; gap:14px; box-shadow:var(--shadow-xs);
            transition:transform 120ms ease, box-shadow 120ms ease;
            &:hover { transform:translateY(-2px); box-shadow:var(--shadow-md); } }
    h2 { margin:0; font-size:16px; font-weight:600; line-height:1.35; }
    .meta { font-size:12px; color:var(--fg-3); }
    .empty { text-align:center; color:var(--fg-3); padding:48px; grid-column:1/-1; }
  `],
  template: `
    <ng-container [libEcapRuntimeRecordList]="folderPayload()"
      (apiResponseEvent)="onFolders($event)" (apiErrorEvent)="onFoldersError($event)">
    </ng-container>
    <ng-container [libEcapRuntimeRecordList]="ackPayload()"
      (apiResponseEvent)="onAcks($event)" (apiErrorEvent)="onAcksError($event)">
    </ng-container>

    <div class="buckets">
      @for (b of buckets(); track b.status) {
        <button type="button" class="bucket" [class.on]="activeStatus() === b.status" (click)="toggleBucket(b.status)">
          <im-status-badge [status]="b.status" [dot]="false" />
          <span class="count">{{ b.count }}</span>
        </button>
      }
      @if (activeStatus()) {
        <button type="button" class="clear" (click)="activeStatus.set(null)">
          {{ lang.isGerman() ? 'Filter zurücksetzen' : 'Clear filter' }}
        </button>
      }
    </div>

    <div class="grid">
      @for (f of visibleFolders(); track f.id) {
        <a class="tile" [routerLink]="['/folders', f.id]">
          <im-status-badge [status]="f.acknowledgmentStatus" />
          <h2>{{ f.name }}</h2>
          <span class="meta">{{ f.confidentiality }}</span>
          <im-completion-bar [data]="stats(f.name)" [showLegend]="false" />
        </a>
      } @empty {
        <p class="empty">
          {{ activeStatus()
            ? (lang.isGerman() ? 'Keine Informationsmappen in diesem Status.' : 'No information folders in this status.')
            : (lang.isGerman() ? 'Noch keine Informationsmappen.' : 'No information folders yet.') }}
        </p>
      }
    </div>
  `
})
export class EstateOverviewComponent {
  readonly lang = inject(LanguageService);

  readonly folderPayload = computed<RecordsPayloadMeta>(() => ({
    id: INFORMATION_FOLDER_VIEW_ID.allRecords, object_id: OBJECT_ID.informationFolder,
    page: 0, pageSize: 200, sortBy: 'date_modified', sortOrder: 'desc', getTotalRecordCount: false
  }));

  readonly ackPayload = computed<RecordsPayloadMeta>(() => ({
    id: ACKNOWLEDGEMENT_VIEW_ID.allForCui, object_id: OBJECT_ID.acknowledgement,
    page: 0, pageSize: 200, sortBy: 'date_modified', sortOrder: 'desc', getTotalRecordCount: false
  }));

  private readonly foldersSignal = signal<FolderTile[]>([]);
  readonly folders = computed(() => this.foldersSignal());

  private readonly ackStatusesByFolderName = signal<Map<string, AckStatus[]>>(new Map());

  onFolders(response: RecordsResponseMeta): void {
    const mapped = (response.listData?.recordsList ?? []).map((raw: any): FolderTile => ({
      id: raw.id,
      name: raw.record_locator ?? '',
      confidentiality: raw.information_folder_picklist_confidentiality_level ?? '',
      acknowledgmentStatus: (raw.information_folder_picklist_acknowledgment_status || 'None') as AckStatus
    }));
    this.foldersSignal.set(mapped);
  }

  onFoldersError(error: unknown): void {
    console.error('Failed to load Information Folder records', error);
    this.foldersSignal.set([]);
  }

  onAcks(response: RecordsResponseMeta): void {
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

  /** Only shows buckets that actually have folders — an empty "Done" pill with 0 isn't useful. */
  readonly buckets = computed(() =>
    BUCKET_STATUSES
      .map((status) => ({ status, count: this.folders().filter((f) => f.acknowledgmentStatus === status).length }))
      .filter((b) => b.count > 0));

  readonly activeStatus = signal<AckStatus | null>(null);

  toggleBucket(status: AckStatus): void {
    this.activeStatus.set(this.activeStatus() === status ? null : status);
  }

  readonly visibleFolders = computed(() => {
    const status = this.activeStatus();
    return status ? this.folders().filter((f) => f.acknowledgmentStatus === status) : this.folders();
  });
}
