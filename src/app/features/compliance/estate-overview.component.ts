import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RecordListDirective, RecordsPayloadMeta, RecordsResponseMeta } from '@escriba/cui-ecap-runtime';
import { AckStatus } from '@core/models';
import { completion } from '@core/rollup';
import { LanguageService } from '@core/i18n/language.service';
import { ACKNOWLEDGEMENT_VIEW_ID, INFORMATION_FOLDER_VIEW_ID, OBJECT_ID } from '@core/objects';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { CompletionBarComponent } from '@shared/ui/completion-bar.component';
import { FilterChipsComponent, Chip } from '@shared/ui/filter-chips.component';

/**
 * documentversion_record's name/displayValue is the full record_locator ("{folder name} -
 * {version}") — only the part after the last " - " is the version itself, same parsing already
 * proven for this shape elsewhere (ack-detail.component.ts, task-list.component.ts, etc.).
 */
function versionLabelOf(displayValue: string | undefined): string {
  return (displayValue ?? '').split(' - ').pop() || '';
}

interface FolderTile {
  id: string;
  name: string;
  category: string;
  confidentiality: string;
  acknowledgmentStatus: AckStatus;
  dateModified: string;
}

interface AckRow {
  status: AckStatus;
  deadline: string;
  versionLabel: string;
}

/**
 * UC-CMP-01 — portfolio view; Compliance's real ACL sees every folder regardless of owner
 * (confirmed via object_properties: Information_Folder's view/record_view criteria include
 * the Complianceverantwortlicher role unconditionally). Real folder list via
 * INFORMATION_FOLDER_VIEW_ID.allRecords — a dedicated "All Records" view distinct from the
 * object's generic (and useless) id-'0' sentinel, confirmed live to return real columns
 * including the folder name (exposed here as record_locator, not a separate name field), its
 * own confidentiality/acknowledgment picklists, document category and date_modified.
 *
 * Completion stats, per-folder version label and "people" count all reuse the same
 * "ALL ACKNOWLEDGEMENTS for CUI" view already proven for Monitoring/chase-table, joined to
 * folders by name — that view exposes the folder's name
 * (acknowledgement_textfield_information_folder_name) but not its id, and folder names are
 * unique in this tenant, so the join is reliable without an extra per-folder request. "People"
 * is a direct count of that folder's real Acknowledgement rows (one row = one recipient), and
 * "Oldest overdue" is computed from the real deadline dates on that folder's Overdue rows —
 * neither is a separate ECAP field.
 *
 * Filtering here is by confidentiality (matching the design), not by acknowledgment status —
 * status is shown per-card as a badge only. The status-bucket pill filter tried earlier this
 * project was replaced by this design; if status filtering is still wanted, the roll-up column
 * filter on the Folders list page (folder-list.component.ts) already covers that.
 */
@Component({
  selector: 'im-estate-overview',
  standalone: true,
  imports: [RouterLink, RecordListDirective, StatusBadgeComponent, CompletionBarComponent, FilterChipsComponent],
  templateUrl: './estate-overview.component.html',
  styleUrl: './estate-overview.component.scss'
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
  readonly loading = signal(true);

  private readonly ackRowsByFolderName = signal<Map<string, AckRow[]>>(new Map());

  onFolders(response: RecordsResponseMeta): void {
    const mapped = (response.listData?.recordsList ?? []).map((raw: any): FolderTile => ({
      id: raw.id,
      name: raw.record_locator ?? '',
      category: raw.information_folder_textfield_document_category ?? '',
      confidentiality: raw.information_folder_picklist_confidentiality_level ?? '',
      acknowledgmentStatus: (raw.information_folder_picklist_acknowledgment_status || 'None') as AckStatus,
      dateModified: raw.date_modified ?? ''
    }));
    this.foldersSignal.set(mapped);
    this.loading.set(false);
  }

  onFoldersError(error: unknown): void {
    console.error('Failed to load Information Folder records', error);
    this.foldersSignal.set([]);
    this.loading.set(false);
  }

  onAcks(response: RecordsResponseMeta): void {
    const byFolder = new Map<string, AckRow[]>();
    for (const raw of response.listData?.recordsList ?? []) {
      const folderName = raw.acknowledgement_textfield_information_folder_name ?? '';
      const row: AckRow = {
        status: (raw.acknowledgment_picklist_status ?? 'None') as AckStatus,
        deadline: raw.acknowledgement_date_deadline_date ?? '',
        versionLabel: versionLabelOf(raw.documentversion_record?.name ?? raw.documentversion_record)
      };
      byFolder.set(folderName, [...(byFolder.get(folderName) ?? []), row]);
    }
    this.ackRowsByFolderName.set(byFolder);
  }

  onAcksError(error: unknown): void {
    console.error('Failed to load Acknowledgement records', error);
    this.ackRowsByFolderName.set(new Map());
  }

  private rowsFor(folderName: string): AckRow[] {
    return this.ackRowsByFolderName().get(folderName) ?? [];
  }

  stats(folderName: string) {
    return completion(this.rowsFor(folderName).map((r) => r.status));
  }

  private versionLabel(folderName: string): string {
    return this.rowsFor(folderName).find((r) => r.versionLabel)?.versionLabel ?? '';
  }

  private peopleCount(folderName: string): number {
    return this.rowsFor(folderName).length;
  }

  oldestOverdueDays(folderName: string): number {
    const deadlines = this.rowsFor(folderName).filter((r) => r.status === 'Overdue' && r.deadline).map((r) => r.deadline);
    if (!deadlines.length) return 0;
    const today = Date.now();
    return Math.max(...deadlines.map((d) => Math.max(0, Math.floor((today - new Date(d).getTime()) / 86_400_000))));
  }

  /** "Category · version · N people" — any part missing (no version yet, no acks yet) is dropped rather than shown blank. */
  metaLine(f: FolderTile): string {
    const version = this.versionLabel(f.name);
    const people = this.peopleCount(f.name);
    const peopleLabel = people ? `${people} ${this.lang.isGerman() ? 'Personen' : 'people'}` : '';
    return [f.category, version, peopleLabel].filter(Boolean).join(' · ');
  }

  /**
   * Right-hand status line under the completion bar. Gated on the real per-acknowledgement
   * deadline data (oldestOverdueDays), not the folder's own summary status field — that field
   * can lag behind the actual acknowledgement records (confirmed live: a folder badged
   * "Pending" can still have a real Overdue acknowledgement underneath it), so trusting it here
   * showed "Oldest overdue" on folders whose badge didn't say Overdue at all.
   */
  trailing(f: FolderTile): string {
    const overdueDays = this.oldestOverdueDays(f.name);
    if (overdueDays > 0) {
      return this.lang.isGerman() ? `Älteste Überfälligkeit: ${overdueDays} Tage` : `Oldest overdue: ${overdueDays} days`;
    }
    if (f.acknowledgmentStatus === 'Done') return this.lang.isGerman() ? 'Abgeschlossen' : 'Complete';
    if (f.acknowledgmentStatus === 'Obsolete' && f.dateModified) {
      return (this.lang.isGerman() ? 'Stillgelegt ' : 'Retired ') + this.lang.date(f.dateModified);
    }
    return '';
  }

  readonly confidentialityFilter = signal('all');
  /** Free-text name search — client-side, same substring/case-insensitive match as the other tabs. */
  readonly nameSearch = signal('');

  readonly chips = computed<Chip[]>(() => [
    { id: 'all', label: this.lang.isGerman() ? 'Alle' : 'All' },
    { id: 'Internal', label: this.lang.isGerman() ? 'Intern' : 'Internal' },
    { id: 'Confidential', label: this.lang.isGerman() ? 'Vertraulich' : 'Confidential' },
    { id: 'Public', label: this.lang.isGerman() ? 'Öffentlich' : 'Public' }
  ]);

  readonly visibleFolders = computed(() => {
    const f = this.confidentialityFilter();
    const search = this.nameSearch().trim().toLowerCase();
    return this.folders()
      .filter((x) => f === 'all' || x.confidentiality === f)
      .filter((x) => !search || x.name.toLowerCase().includes(search));
  });
}
