import { Component, inject, input } from '@angular/core';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import {
  DOCUMENT_VERSION_ACKNOWLEDGEMENT_SECTION_ID, INFORMATION_FOLDER_VERSIONS_SECTION_ID, OBJECT_ID
} from '@core/objects';
import { AckStatus } from '@core/models';
import { completion } from '@core/rollup';

interface ActiveVersion { id: string; versionLabel: string; dateModified: string | null; }

/**
 * Real replacement for what used to be a hardcoded stats strip (the previous version's
 * `cells` array was a literal, unwired placeholder — no "sync" between our app and ECAP
 * actually exists to report on, since every read here hits ECAP live). Shows: the folder's
 * current Active Document Version, and the real Acknowledgement rows tied to it (their count
 * IS the real target-group size — the audience ECAP's own server-side rule already resolved
 * into acknowledgements — plus a completion breakdown). Both reads go through the real
 * relatedObjectList endpoint (confirmed live via network capture of ECAP's own related-list
 * grids) rather than the generic rest/record/{oid}?filter=... list endpoint, which this
 * tenant has shown to be unreliable for these exact objects independent of retries/page size.
 */
@Component({
  selector: 'im-sync-diagnostics',
  standalone: true,
  styles: [`
    .strip { display:flex; gap:0; border-top:1px solid var(--border-dark); padding-top:16px; flex-wrap:wrap; }
    .cell { flex:1; min-width:150px; padding-right:20px; display:flex; flex-direction:column; gap:5px; }
    .label { font-size:10px; font-weight:700; letter-spacing:.14em; color:var(--on-dark-4); }
    .value { font-size:20px; font-weight:300; color:#fff; }
    .value.bad { color:var(--danger); }
    .note { font-size:11px; color:var(--on-dark-3); }
  `],
  template: `
    <div class="strip">
      <div class="cell">
        <span class="label">{{ lang.isGerman() ? 'AKTIVE VERSION' : 'ACTIVE VERSION' }}</span>
        <span class="value">{{ activeVersion() ? activeVersion()!.versionLabel + ' ✓' : '—' }}</span>
        <span class="note">
          {{ activeVersion()?.dateModified ? (lang.isGerman() ? 'seit ' : 'since ') + lang.date(activeVersion()!.dateModified!) : '' }}
        </span>
      </div>
      <div class="cell">
        <span class="label">{{ lang.isGerman() ? 'ZIELGRUPPE' : 'TARGET GROUP' }}</span>
        <span class="value">{{ acks().length }}</span>
        <span class="note">
          {{ orgUnitCount() }} {{ lang.isGerman() ? 'Teams' : 'teams' }} · {{ userCount() }} {{ lang.isGerman() ? 'direkt' : 'direct' }}
        </span>
      </div>
      <div class="cell">
        <span class="label">{{ lang.isGerman() ? 'KENNTNISNAHMEN' : 'ACKNOWLEDGEMENT' }}</span>
        <span class="value" [class.bad]="stats().overdue > 0">{{ acks().length }}</span>
        <span class="note">
          {{ stats().done }} {{ lang.isGerman() ? 'erledigt' : 'completed' }} · {{ stats().overdue }} {{ lang.isGerman() ? 'überfällig' : 'overdue' }}
        </span>
      </div>
    </div>
  `
})
export class SyncDiagnosticsComponent {
  private readonly http = inject(HttpClient);
  readonly lang = inject(LanguageService);
  readonly folderId = input.required<string>();
  /** Bump to force a refetch — e.g. right after adding a user/org unit, so these stats don't wait for a full page reload. */
  readonly refreshTick = input(0);

  private readonly folderId$ = toObservable(this.folderId);
  private readonly refresh$ = toObservable(this.refreshTick);

  readonly activeVersion = toSignal(
    combineLatest([this.folderId$, this.refresh$]).pipe(switchMap(([folderId]) => this.fetchActiveVersion(folderId))),
    { initialValue: null as ActiveVersion | null }
  );

  readonly acks = toSignal(
    combineLatest([this.folderId$, this.refresh$]).pipe(
      switchMap(([folderId]) => this.fetchActiveVersion(folderId)),
      switchMap((version) => version ? this.fetchAcks(version.id) : of([] as AckStatus[]))
    ),
    { initialValue: [] as AckStatus[] }
  );

  readonly stats = () => completion(this.acks());

  readonly orgUnitCount = toSignal(
    combineLatest([this.folderId$, this.refresh$]).pipe(switchMap(([folderId]) => this.fetchCount(OBJECT_ID.organizationalUnits, folderId))),
    { initialValue: 0 }
  );

  readonly userCount = toSignal(
    combineLatest([this.folderId$, this.refresh$]).pipe(switchMap(([folderId]) => this.fetchCount(OBJECT_ID.employees, folderId))),
    { initialValue: 0 }
  );

  private fetchActiveVersion(folderId: string): Observable<ActiveVersion | null> {
    if (!folderId) return of(null);
    return this.http.get<any>('/networking/solution/ServiceDesk/relatedObjectList', {
      params: {
        record_id: folderId, p_objectId: OBJECT_ID.informationFolder,
        related_section_id: INFORMATION_FOLDER_VERSIONS_SECTION_ID,
        paginationRequired: true, page: 1, pageSize: 200, _uiVersion: 3, sortBy: 'date_modified', sortOrder: 'desc'
      }
    }).pipe(
      map((response) => {
        const rows = response?.[INFORMATION_FOLDER_VERSIONS_SECTION_ID]?.relatedInfoData ?? [];
        const active = rows.find((r: any) => r.version_picklist_version_status === 'Active');
        if (!active) return null;
        return {
          id: active.id,
          versionLabel: (active.record_locator ?? '').split(' - ').pop() || active.id,
          dateModified: active.date_modified || null
        };
      }),
      catchError((err) => { console.error('Active version lookup failed', err); return of(null); })
    );
  }

  private fetchAcks(versionId: string): Observable<AckStatus[]> {
    return this.http.get<any>('/networking/solution/ServiceDesk/relatedObjectList', {
      params: {
        record_id: versionId, p_objectId: OBJECT_ID.documentVersion,
        related_section_id: DOCUMENT_VERSION_ACKNOWLEDGEMENT_SECTION_ID,
        paginationRequired: true, page: 1, pageSize: 200, _uiVersion: 3
      }
    }).pipe(
      map((response) => {
        const rows = response?.[DOCUMENT_VERSION_ACKNOWLEDGEMENT_SECTION_ID]?.relatedInfoData ?? [];
        return rows.map((r: any): AckStatus => r.acknowledgment_picklist_status ?? 'Pending');
      }),
      catchError((err) => { console.error('Acknowledgement fetch failed', err); return of([] as AckStatus[]); })
    );
  }

  private fetchCount(objectId: string, folderId: string): Observable<number> {
    if (!folderId) return of(0);
    return this.http.get<any>(`/networking/rest/record/${objectId}`, {
      params: {
        filter: `(informationfolder_record equals '${folderId}')`,
        fieldList: 'id', pageSize: 1, getTotalRecordCount: true, alt: 'json'
      }
    }).pipe(
      map((response) => Number(response?.platform?.totalRecordCount ?? 0)),
      catchError((err) => { console.error(`Count fetch failed for ${objectId}`, err); return of(0); })
    );
  }
}
