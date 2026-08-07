import { Observable } from 'rxjs';
import { Acknowledgement, AppUser, DistributionTemplate, DocumentVersion, InformationFolder, OrganizationalUnit, Team } from '../models';

/** Everything the UI needs from the backend. Implemented by Mock and Http services. */
export abstract class DataPort {
  abstract folders(): Observable<InformationFolder[]>;
  abstract folder(id: string): Observable<InformationFolder>;
  /** Metadata edit on an existing folder — e.g. redefining the deadline on a published folder. */
  abstract updateFolder(id: string, changes: Partial<InformationFolder>): Observable<void>;
  abstract versions(folderId: string): Observable<DocumentVersion[]>;
  abstract acknowledgements(query: { folderId?: string; userId?: string }): Observable<Acknowledgement[]>;
  abstract teams(): Observable<Team[]>;
  abstract users(): Observable<AppUser[]>;
  abstract templates(): Observable<DistributionTemplate[]>;
  /** Upsert: omit id (or pass one that doesn't exist yet) to create, pass an existing id to update. */
  abstract saveTemplate(template: { id?: string; name: string; teams: DistributionTemplate['teams']; userIds: string[] }): Observable<DistributionTemplate>;
  abstract orgUnits(folderId: string): Observable<OrganizationalUnit[]>;

  /** Macro "Activate Document Version". Creates acks + emails server-side. */
  abstract activateVersion(versionId: string): Observable<{ acknowledgementsCreated: number }>;
  abstract deactivateFolder(folderId: string): Observable<void>;
  abstract activateFolder(folderId: string): Observable<void>;
  /** Completes the BPM user task. The rule set then sets status = Done. */
  abstract completeAckTask(taskId: string, comment?: string): Observable<void>;
  /** Compliance-only. Requires a reason; written to the audit trail. */
  abstract overrideAckStatus(ackId: string, status: string, reason: string): Observable<void>;
  /** Not in the tenant yet — see brief §8.2 UC-IP-06. */
  abstract remind(ackIds: string[]): Observable<{ sent: number }>;
  abstract uploadVersionFile(versionId: string, file: File): Observable<{ ok: boolean; message?: string }>;
  abstract applyTemplateToFolder(folderId: string, templateId: string): Observable<void>;
}
