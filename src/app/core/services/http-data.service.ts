import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import {
  Acknowledgement, AppUser, DistributionTemplate, DocumentVersion,
  InformationFolder, OrganizationalUnit, Team
} from '../models';
import { API_BASE, OBJECT_ID } from '../objects';
import { DataPort } from './data.port';

interface RecordEnvelope<T> { platform: { record: T[] } }

/**
 * AgileApps REST binding. Endpoints follow /networking/rest/record/{objectId}.
 * Not wired into app.config by default — see README.
 */
@Injectable({ providedIn: 'root' })
export class HttpDataService extends DataPort {
  private readonly http = inject(HttpClient);

  private records<T>(objectId: string, filter?: string): Observable<T[]> {
    const url = `${API_BASE}/record/${objectId}` + (filter ? `?filter=${encodeURIComponent(filter)}` : '');
    return this.http.get<RecordEnvelope<T>>(url).pipe(map((r) => r.platform.record ?? []));
  }

  override folders() { return this.records<InformationFolder>(OBJECT_ID.informationFolder); }
  override folder(id: string) {
    return this.http.get<RecordEnvelope<InformationFolder>>(`${API_BASE}/record/${OBJECT_ID.informationFolder}/${id}`)
      .pipe(map((r) => r.platform.record[0]));
  }
  override updateFolder(id: string, changes: Partial<InformationFolder>) {
    return this.http.patch<void>(`${API_BASE}/record/${OBJECT_ID.informationFolder}/${id}`, changes);
  }
  override versions(folderId: string) {
    return this.records<DocumentVersion>(OBJECT_ID.documentVersion, `informationfolder_record='${folderId}'`);
  }
  override acknowledgements(q: { folderId?: string; userId?: string }) {
    const clauses = [
      q.folderId ? `acknowledgement_lookup_information_folder='${q.folderId}'` : '',
      q.userId ? `acknowledgement_lookup_user='${q.userId}'` : ''
    ].filter(Boolean).join(' AND ');
    return this.records<Acknowledgement>(OBJECT_ID.acknowledgement, clauses || undefined);
  }
  override teams() { return this.records<Team>(OBJECT_ID.teams); }
  override users() { return this.records<AppUser>(OBJECT_ID.users); }
  override templates() { return this.records<DistributionTemplate>(OBJECT_ID.distributionTemplate); }
  override saveTemplate(template: { id?: string; name: string; teams: DistributionTemplate['teams']; userIds: string[] }) {
    return template.id
      ? this.http.patch<DistributionTemplate>(`${API_BASE}/record/${OBJECT_ID.distributionTemplate}/${template.id}`, template)
      : this.http.post<DistributionTemplate>(`${API_BASE}/record/${OBJECT_ID.distributionTemplate}`, template);
  }
  override orgUnits(folderId: string) {
    return this.records<OrganizationalUnit>(OBJECT_ID.organizationalUnits, `folderId='${folderId}'`);
  }

  /** Macro "Activate Document Version". */
  override activateVersion(versionId: string) {
    return this.http.post<{ acknowledgementsCreated: number }>(
      `${API_BASE}/macro/activateDocumentVersion/${versionId}`, {});
  }
  override activateFolder(folderId: string) {
    return this.http.post<void>(`${API_BASE}/macro/activateInformationFolder/${folderId}`, {});
  }
  override deactivateFolder(folderId: string) {
    return this.http.post<void>(`${API_BASE}/macro/deactivateInformationFolder/${folderId}`, {});
  }

  /** BPM task completion — never a record update. */
  override completeAckTask(taskId: string, comment?: string) {
    return this.http.put<void>(`${API_BASE}/task/${taskId}`, { status: 'Completed', comment });
  }
  override overrideAckStatus(ackId: string, status: string, reason: string) {
    return this.http.patch<void>(`${API_BASE}/record/${OBJECT_ID.acknowledgement}/${ackId}`,
      { acknowledgment_picklist_status: status, override_reason: reason });
  }
  override remind(ackIds: string[]) {
    return this.http.post<{ sent: number }>(`${API_BASE}/im/acknowledgements/remind`, { ackIds });
  }
  override uploadVersionFile(versionId: string, file: File) {
    const body = new FormData();
    body.append('file', file);
    return this.http.post<{ ok: boolean; message?: string }>(
      `${API_BASE}/dms/${OBJECT_ID.documentVersion}/${versionId}/file`, body);
  }
  override applyTemplateToFolder(folderId: string, templateId: string) {
    return this.http.patch<void>(`${API_BASE}/record/${OBJECT_ID.informationFolder}/${folderId}`,
      { information_folder_lu_distribution_list: templateId });
  }
}
