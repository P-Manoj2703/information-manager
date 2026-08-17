import { Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { catchError, map, of, switchMap } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { INFORMATION_FOLDER_VERSIONS_SECTION_ID, OBJECT_ID } from '@core/objects';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { VersionStatus } from '@core/models/enums';

interface VersionRow {
  id: string;
  versionLabel: string;
  status: VersionStatus;
  dateModified: string | null;
  description: string;
  /** The next-newer version's own start date — i.e. when this version stopped being current. null for the most recent row (still ongoing). */
  validUntil: string | null;
}

/**
 * UC-IP-05 — exactly one Active among however many Draft/Inactive versions exist. Each entry
 * opens that version's own record. Uses the real relatedObjectList endpoint (confirmed live
 * via network capture of ECAP's own "Versions" related grid on the folder) rather than the
 * generic rest/record/{oid}?filter=... list endpoint — that generic endpoint proved unreliable
 * for this exact object/folder combination independent of retries or page size, while
 * relatedObjectList (what native ECAP itself actually calls) returned all rows correctly on
 * every attempt.
 */
@Component({
  selector: 'im-version-timeline',
  standalone: true,
  imports: [RouterLink, StatusBadgeComponent],
  templateUrl: './version-timeline.component.html',
  styleUrl: './version-timeline.component.scss'
})
export class VersionTimelineComponent {
  private readonly http = inject(HttpClient);
  readonly lang = inject(LanguageService);
  readonly folderId = input.required<string>();

  readonly loading = signal(true);

  readonly versions = toSignal(
    toObservable(this.folderId).pipe(
      switchMap((folderId) => this.fetchVersions(folderId)),
      map((rows) => { this.loading.set(false); return this.withValidUntil(rows); })
    ),
    { initialValue: [] as VersionRow[] }
  );

  private fetchVersions(folderId: string) {
    if (!folderId) return of([] as VersionRow[]);
    return this.http.get<any>('/networking/solution/ServiceDesk/relatedObjectList', {
      params: {
        record_id: folderId,
        p_objectId: OBJECT_ID.informationFolder,
        related_section_id: INFORMATION_FOLDER_VERSIONS_SECTION_ID,
        paginationRequired: true, page: 1, pageSize: 200,
        _uiVersion: 3, sortBy: 'date_modified', sortOrder: 'desc'
      }
    }).pipe(
      map((response): VersionRow[] => {
        const rows = response?.[INFORMATION_FOLDER_VERSIONS_SECTION_ID]?.relatedInfoData ?? [];
        return rows.map((r: any): VersionRow => ({
          id: r.id,
          // record_locator is "{folder name} - {version id}" — the version id itself isn't
          // one of this related-list widget's configured columns, so it's parsed out here.
          versionLabel: (r.record_locator ?? '').split(' - ').pop() || r.id,
          // Plain string here, unlike the generic REST endpoint's {displayValue, content} shape.
          status: r.version_picklist_version_status ?? 'Draft',
          dateModified: r.date_modified || null,
          description: r.version_textarea_description ?? '',
          validUntil: null
        }));
      }),
      catchError((err) => { console.error('Document Version list fetch failed', err); return of([] as VersionRow[]); })
    );
  }

  /** Rows arrive newest-first; each row's "valid until" is simply the next-newer row's own start date — no extra field needed. */
  private withValidUntil(rows: VersionRow[]): VersionRow[] {
    return rows.map((v, i) => i === 0 ? v : { ...v, validUntil: rows[i - 1].dateModified });
  }
}
