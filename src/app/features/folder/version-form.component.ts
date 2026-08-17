import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { catchError, map, of, switchMap } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { PageSubtitleService } from '@core/services/page-subtitle.service';
import { INFORMATION_FOLDER_VERSIONS_SECTION_ID, OBJECT_ID } from '@core/objects';
import { VersionUploadComponent } from './version-upload.component';
import { ActivateDialogComponent } from './activate-dialog.component';

/** UC-IP-05 — a new version on an existing folder re-asks the whole audience. */
@Component({
  selector: 'im-version-form',
  standalone: true,
  imports: [RouterLink, VersionUploadComponent, ActivateDialogComponent],
  templateUrl: './version-form.component.html',
  styleUrl: './version-form.component.scss'
})
export class VersionFormComponent {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly pageSubtitle = inject(PageSubtitleService);
  private readonly destroyRef = inject(DestroyRef);
  readonly lang = inject(LanguageService);
  readonly id = input.required<string>();
  readonly versionRecordId = signal('');

  readonly folderName = toSignal(
    toObservable(this.id).pipe(switchMap((folderId) => this.fetchFolderName(folderId))),
    { initialValue: '' }
  );

  constructor() {
    // Shell topbar shows a generic "New version" title here — this fills in the real folder name as its subtitle, same mechanism folder-detail.component.ts uses.
    effect(() => {
      const name = this.folderName();
      if (name) this.pageSubtitle.set(name);
    });
    this.destroyRef.onDestroy(() => this.pageSubtitle.clear());
  }

  /** version-upload.component.ts's own (back) emit carries no routing logic — this is the one place on this page that actually navigates. */
  goBack(): void {
    this.router.navigate(['/folders', this.id()]);
  }

  readonly orgUnitCount = toSignal(
    toObservable(this.id).pipe(switchMap((folderId) => this.fetchCount(OBJECT_ID.organizationalUnits, folderId))),
    { initialValue: 0 }
  );

  readonly userCount = toSignal(
    toObservable(this.id).pipe(switchMap((folderId) => this.fetchCount(OBJECT_ID.employees, folderId))),
    { initialValue: 0 }
  );

  readonly confidentialityLevel = toSignal(
    toObservable(this.id).pipe(switchMap((folderId) => this.fetchConfidentialityLevel(folderId))),
    { initialValue: '' }
  );

  /** Best-effort — the current Active version's own id + label, shown in the "will be deactivated" warning. */
  private readonly activeVersion = toSignal(
    toObservable(this.id).pipe(switchMap((folderId) => this.fetchActiveVersion(folderId))),
    { initialValue: null as { id: string; label: string } | null }
  );
  readonly activeVersionLabel = computed(() => this.activeVersion()?.label ?? null);

  /** How many people already confirmed the version about to be superseded — they get asked again. */
  readonly supersededConfirmedCount = toSignal(
    toObservable(this.activeVersion).pipe(switchMap((v) => v ? this.fetchConfirmedCount(v.id) : of(0))),
    { initialValue: 0 }
  );

  onVersionSaved(versionId: string): void {
    this.versionRecordId.set(versionId);
  }

  private fetchFolderName(folderId: string) {
    if (!folderId) return of('');
    return this.http.get<any>(`/networking/rest/record/${OBJECT_ID.informationFolder}/${folderId}`, {
      params: { fieldList: 'information_folder_textfield_name', alt: 'json' }
    }).pipe(
      map((response) => response?.platform?.record?.information_folder_textfield_name ?? ''),
      catchError((err) => { console.error('Folder name fetch failed', err); return of(''); })
    );
  }

  private fetchConfidentialityLevel(folderId: string) {
    if (!folderId) return of('');
    return this.http.get<any>(`/networking/rest/record/${OBJECT_ID.informationFolder}/${folderId}`, {
      params: { fieldList: 'information_folder_picklist_confidentiality_level', alt: 'json' }
    }).pipe(
      map((response) => response?.platform?.record?.information_folder_picklist_confidentiality_level?.content ?? ''),
      catchError((err) => { console.error('Confidentiality level fetch failed', err); return of(''); })
    );
  }

  private fetchCount(objectId: string, folderId: string) {
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

  /**
   * Goes through the real relatedObjectList endpoint (confirmed live), not the generic
   * rest/record/{oid}?filter=... list endpoint, which proved unreliable for this exact
   * object/folder combination independent of retries or page size.
   */
  private fetchActiveVersion(folderId: string) {
    if (!folderId) return of(null as { id: string; label: string } | null);
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
        return { id: active.id, label: (active.record_locator ?? '').split(' - ').pop() || active.id };
      }),
      catchError((err) => { console.error('Active version lookup failed', err); return of(null as { id: string; label: string } | null); })
    );
  }

  /** Counts Acknowledgement rows already at 'Done' for the version about to be superseded — those recipients get asked again. */
  private fetchConfirmedCount(versionId: string) {
    return this.http.get<any>(`/networking/rest/record/${OBJECT_ID.acknowledgement}`, {
      params: {
        filter: `(documentversion_record equals '${versionId}')`,
        fieldList: 'acknowledgment_picklist_status', pageSize: 500, alt: 'json'
      }
    }).pipe(
      map((response) => [response?.platform?.record ?? []].flat()
        .filter((r: any) => r.acknowledgment_picklist_status === 'Done').length),
      catchError((err) => { console.error('Confirmed count fetch failed', err); return of(0); })
    );
  }
}
