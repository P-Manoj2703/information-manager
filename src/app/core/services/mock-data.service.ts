import { Injectable } from '@angular/core';
import { Observable, delay, of } from 'rxjs';
import {
  Acknowledgement, AppUser, DistributionTemplate, DocumentVersion,
  InformationFolder, OrganizationalUnit, Team
} from '../models';
import { DataPort } from './data.port';
import { SERVER_MESSAGE } from '../server-messages';

const LATENCY = 220;
const iso = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

const TEAMS: Team[] = [
  { id: 't0', information_manager_teams_textfield_name: 'ESCRIBA GmbH', parent_team_id: null, memberCount: 66 },
  { id: 't1', information_manager_teams_textfield_name: 'Personalwesen', parent_team_id: 't0', memberCount: 12 },
  { id: 't2', information_manager_teams_textfield_name: 'Vertrieb', parent_team_id: 't0', memberCount: 9 },
  { id: 't2a', information_manager_teams_textfield_name: 'Vertrieb Innendienst', parent_team_id: 't2', memberCount: 14 },
  { id: 't2b', information_manager_teams_textfield_name: 'Vertrieb Außendienst', parent_team_id: 't2', memberCount: 21 },
  { id: 't3', information_manager_teams_textfield_name: 'IT & Infrastruktur', parent_team_id: 't0', memberCount: 18 },
  { id: 't4', information_manager_teams_textfield_name: 'Recht & Compliance', parent_team_id: 't0', memberCount: 7 },
  { id: 't5', information_manager_teams_textfield_name: 'Arbeitsschutz', parent_team_id: 't0', memberCount: 5 }
];

const USERS: AppUser[] = [
  { id: 'u-anna', firstName: 'Anna', lastName: 'Vogt', userName: 'a.vogt', email: 'anna.vogt@escriba.de', primaryTeamId: 't1', active: true },
  { id: 'u-markus', firstName: 'Markus', lastName: 'Bauer', userName: 'm.bauer', email: 'markus.bauer@escriba.de', primaryTeamId: 't5', active: true },
  { id: 'u-petra', firstName: 'Petra', lastName: 'Lindner', userName: 'p.lindner', email: 'petra.lindner@escriba.de', primaryTeamId: 't4', active: true },
  { id: 'u-julia', firstName: 'Julia', lastName: 'Schneider', userName: 'j.schneider', email: 'julia.schneider@escriba.de', primaryTeamId: 't2a', active: true },
  { id: 'u-tobias', firstName: 'Tobias', lastName: 'Reinhardt', userName: 't.reinhardt', email: 'tobias.reinhardt@escriba.de', primaryTeamId: 't2b', active: true },
  { id: 'u-claudia', firstName: 'Claudia', lastName: 'Mertens', userName: 'c.mertens', email: 'claudia.mertens@escriba.de', primaryTeamId: 't1', active: true },
  { id: 'u-ibrahim', firstName: 'Ibrahim', lastName: 'Yildiz', userName: 'i.yildiz', email: 'ibrahim.yildiz@escriba.de', primaryTeamId: 't3', active: true },
  { id: 'u-heiko', firstName: 'Heiko', lastName: 'Wendt', userName: 'h.wendt', email: 'heiko.wendt@escriba.de', primaryTeamId: 't2b', active: false }
];

const FOLDERS: InformationFolder[] = [
  {
    id: 'f1',
    information_folder_textfield_name: 'Arbeitssicherheit — Unterweisung 2026',
    information_folder_textfield_short_name: 'AS-2026',
    information_folder_richtext_area_user_information:
      '<p>Die jährliche Unterweisung zur Arbeitssicherheit wurde für 2026 überarbeitet. Bitte lesen Sie das Dokument vollständig und bestätigen Sie die Kenntnisnahme innerhalb der Frist.</p>',
    information_folder_textfield_document_category: 'Unterweisung',
    information_folder_picklist_confidentiality_level: 'Internal',
    information_folder_picklist_status: 'Active',
    information_folder_picklist_acknowledgment_status: 'Pending',
    information_folder_number_deadlinedays: 14,
    information_folder_lookup_responsible_team: 't5',
    information_folder_text_field_primary_team_id: 't5',
    created_id: 'u-markus'
  },
  {
    id: 'f2',
    information_folder_textfield_name: 'Datenschutz-Richtlinie (DSGVO)',
    information_folder_textfield_short_name: 'DS-1.4',
    information_folder_richtext_area_user_information:
      '<p>Die Richtlinie wurde um die neuen Auftragsverarbeitungsregelungen ergänzt. Betroffen sind alle Mitarbeitenden mit Zugriff auf Kundendaten.</p>',
    information_folder_textfield_document_category: 'Richtlinie',
    information_folder_picklist_confidentiality_level: 'Confidential',
    information_folder_picklist_status: 'Active',
    information_folder_picklist_acknowledgment_status: 'Overdue',
    information_folder_number_deadlinedays: 10,
    information_folder_lookup_responsible_team: 't4',
    information_folder_text_field_primary_team_id: 't4',
    created_id: 'u-petra'
  },
  {
    id: 'f3',
    information_folder_textfield_name: 'Reisekostenordnung',
    information_folder_richtext_area_user_information: '<p>Neufassung der Reisekostenordnung.</p>',
    information_folder_picklist_confidentiality_level: 'Internal',
    information_folder_picklist_status: 'Draft',
    information_folder_picklist_acknowledgment_status: 'None',
    information_folder_number_deadlinedays: 21,
    information_folder_lookup_responsible_team: 't1',
    information_folder_text_field_primary_team_id: 't5',
    created_id: 'u-markus'
  }
];

const VERSIONS: DocumentVersion[] = [
  { id: 'v21', document_version_textfield_name: 'Unterweisung 2026, korrigierte Fassung', version_text_field_version_id: 'v2.1',
    informationfolder_record: 'f1', version_picklist_version_status: 'Active',
    version_date_time_valid_from: iso(-12), version_date_time_valid_until: null, version_number_total_document_count: 2 },
  { id: 'v20', document_version_textfield_name: 'Unterweisung 2026', version_text_field_version_id: 'v2.0',
    informationfolder_record: 'f1', version_picklist_version_status: 'Inactive',
    version_date_time_valid_from: iso(-51), version_date_time_valid_until: iso(-12), version_number_total_document_count: 1 },
  { id: 'v14', document_version_textfield_name: 'DSGVO-Richtlinie', version_text_field_version_id: 'v1.4',
    informationfolder_record: 'f2', version_picklist_version_status: 'Active',
    version_date_time_valid_from: iso(-17), version_date_time_valid_until: null, version_number_total_document_count: 1 }
];

const ack = (
  id: string, userId: string, employee: string, folder: InformationFolder,
  versionId: string, status: Acknowledgement['acknowledgment_picklist_status'], deadlineOffset: number
): Acknowledgement => ({
  id,
  acknowledgment_picklist_status: status,
  acknowledgement_date_deadline_date: iso(deadlineOffset),
  acknowledgment_textfield_employee: employee,
  acknowledgement_lookup_user: userId,
  acknowledgment_email_address_email: USERS.find((u) => u.id === userId)?.email ?? '',
  acknowledgement_lookup_information_folder: folder.id,
  acknowledgement_textfield_information_folder_name: folder.information_folder_textfield_name,
  documentversion_record: versionId,
  acknowledgment_richtextarea_user_information: folder.information_folder_richtext_area_user_information,
  acknowledgement_text_field_primary_team_id: folder.information_folder_text_field_primary_team_id,
  taskId: status === 'Pending' || status === 'Overdue' ? `task-${id}` : undefined
});

const ACKS: Acknowledgement[] = [
  ack('a1', 'u-anna', 'Anna Vogt', FOLDERS[1], 'v14', 'Overdue', -3),
  ack('a2', 'u-anna', 'Anna Vogt', FOLDERS[0], 'v21', 'Pending', 2),
  ack('a3', 'u-anna', 'Anna Vogt', FOLDERS[0], 'v20', 'Obsolete', -30),
  ack('a4', 'u-julia', 'Julia Schneider', FOLDERS[1], 'v14', 'Overdue', -3),
  ack('a5', 'u-tobias', 'Tobias Reinhardt', FOLDERS[1], 'v14', 'Overdue', -3),
  ack('a6', 'u-claudia', 'Claudia Mertens', FOLDERS[0], 'v21', 'Overdue', -5),
  ack('a7', 'u-ibrahim', 'Ibrahim Yildiz', FOLDERS[0], 'v21', 'Pending', 2),
  ack('a8', 'u-markus', 'Markus Bauer', FOLDERS[0], 'v21', 'Done', -1)
];

const TEMPLATES: DistributionTemplate[] = [
  { id: 'dl1', name: 'Alle Standorte DACH', teams: [{ teamId: 't0', includeTeamHierarchy: true }], userIds: [] },
  { id: 'dl2', name: 'Vertrieb gesamt', teams: [{ teamId: 't2', includeTeamHierarchy: true }], userIds: [] },
  { id: 'dl3', name: 'Neue Mitarbeitende 2026', teams: [], userIds: ['u-julia', 'u-tobias'] }
];

const ORG_UNITS: OrganizationalUnit[] = [
  { id: 'ou1', folderId: 'f1', teamId: 't2', includeTeamHierarchy: true, autoLinked: false },
  { id: 'ou2', folderId: 'f1', teamId: 't2a', includeTeamHierarchy: false, autoLinked: true },
  { id: 'ou3', folderId: 'f1', teamId: 't1', includeTeamHierarchy: false, autoLinked: false }
];

/**
 * In-memory backend for local development and design review.
 * Replace with HttpDataService against /networking/rest — see README.
 */
@Injectable({ providedIn: 'root' })
export class MockDataService extends DataPort {
  private readonly acks = [...ACKS];

  private ok<T>(value: T): Observable<T> { return of(value).pipe(delay(LATENCY)); }

  // Fresh array/object copies on every call — mirrors a real HTTP response and lets Angular's
  // signal equality checks see an update after a mutation (deactivateFolder, updateFolder, ...).
  override folders(): Observable<InformationFolder[]> { return this.ok([...FOLDERS]); }
  override folder(id: string): Observable<InformationFolder> {
    return this.ok({ ...(FOLDERS.find((f) => f.id === id) ?? FOLDERS[0]) });
  }
  override updateFolder(id: string, changes: Partial<InformationFolder>): Observable<void> {
    const target = FOLDERS.find((f) => f.id === id);
    if (target) Object.assign(target, changes);
    return this.ok(undefined);
  }
  override versions(folderId: string): Observable<DocumentVersion[]> {
    return this.ok(VERSIONS.filter((v) => v.informationfolder_record === folderId));
  }
  override acknowledgements(q: { folderId?: string; userId?: string }): Observable<Acknowledgement[]> {
    return this.ok(this.acks.filter((a) =>
      (!q.folderId || a.acknowledgement_lookup_information_folder === q.folderId) &&
      (!q.userId || a.acknowledgement_lookup_user === q.userId)));
  }
  override teams(): Observable<Team[]> { return this.ok([...TEAMS]); }
  override users(): Observable<AppUser[]> { return this.ok([...USERS]); }
  override templates(): Observable<DistributionTemplate[]> { return this.ok([...TEMPLATES]); }
  override saveTemplate(template: { id?: string; name: string; teams: DistributionTemplate['teams']; userIds: string[] }): Observable<DistributionTemplate> {
    const existing = template.id ? TEMPLATES.find((t) => t.id === template.id) : undefined;
    if (existing) {
      Object.assign(existing, { name: template.name, teams: template.teams, userIds: template.userIds });
      return this.ok({ ...existing });
    }
    const created: DistributionTemplate = {
      id: `dl-${Date.now().toString(36)}`,
      name: template.name, teams: template.teams, userIds: template.userIds
    };
    TEMPLATES.push(created);
    return this.ok({ ...created });
  }
  override orgUnits(folderId: string): Observable<OrganizationalUnit[]> {
    return this.ok(ORG_UNITS.filter((o) => o.folderId === folderId));
  }

  override activateVersion(versionId: string): Observable<{ acknowledgementsCreated: number }> {
    return this.ok({ acknowledgementsCreated: 128 });
  }
  override deactivateFolder(folderId: string): Observable<void> {
    const target = FOLDERS.find((f) => f.id === folderId);
    if (target) target.information_folder_picklist_status = 'Inactive';
    return this.ok(undefined);
  }
  override activateFolder(folderId: string): Observable<void> {
    const target = FOLDERS.find((f) => f.id === folderId);
    if (target) target.information_folder_picklist_status = 'Active';
    return this.ok(undefined);
  }

  override completeAckTask(taskId: string): Observable<void> {
    const target = this.acks.find((a) => a.taskId === taskId);
    if (target) { target.acknowledgment_picklist_status = 'Done'; target.taskId = undefined; }
    return this.ok(undefined);
  }
  override overrideAckStatus(ackId: string, status: string): Observable<void> {
    const target = this.acks.find((a) => a.id === ackId);
    if (target) target.acknowledgment_picklist_status = status as Acknowledgement['acknowledgment_picklist_status'];
    return this.ok(undefined);
  }
  override remind(ackIds: string[]): Observable<{ sent: number }> { return this.ok({ sent: ackIds.length }); }

  override uploadVersionFile(_versionId: string, file: File): Observable<{ ok: boolean; message?: string }> {
    return file.type === 'application/pdf'
      ? this.ok({ ok: true })
      : this.ok({ ok: false, message: SERVER_MESSAGE.nonPdf(file.name) });
  }
  override applyTemplateToFolder(): Observable<void> { return this.ok(undefined); }
}
