import { Acknowledgement, AppUser, DistributionTemplate, DocumentVersion, InformationFolder, OrganizationalUnitLink, Team } from '@core/models';

export const MOCK_TEAMS: Team[] = [
  { id: 't-root', name: 'ESCRIBA GmbH', parentTeamId: null, memberCount: 0 },
  { id: 't-personalwesen', name: 'Personalwesen', parentTeamId: 't-root', memberCount: 12 },
  { id: 't-vertrieb', name: 'Vertrieb', parentTeamId: 't-root', memberCount: 9 },
  { id: 't-vertrieb-innen', name: 'Vertrieb Innendienst', parentTeamId: 't-vertrieb', memberCount: 14 },
  { id: 't-vertrieb-aussen', name: 'Vertrieb Außendienst', parentTeamId: 't-vertrieb', memberCount: 21 },
  { id: 't-it', name: 'IT & Infrastruktur', parentTeamId: 't-root', memberCount: 18 },
  { id: 't-it-betrieb', name: 'IT Betrieb', parentTeamId: 't-it', memberCount: 6 },
  { id: 't-recht', name: 'Recht & Compliance', parentTeamId: 't-root', memberCount: 7 }
];

export const MOCK_USERS: AppUser[] = [
  { id: 'u-anna-vogt', firstName: 'Anna', lastName: 'Vogt', userName: 'a.vogt', email: 'anna.vogt@escriba.de', platformUserId: '1041', active: true, primaryTeamId: 't-personalwesen', primaryTeamName: 'Personalwesen', roles: ['kenntnissnahmeempfaenger'] },
  { id: 'u-markus-bauer', firstName: 'Markus', lastName: 'Bauer', userName: 'm.bauer', email: 'markus.bauer@escriba.de', platformUserId: '1042', active: true, primaryTeamId: 't-recht', primaryTeamName: 'Recht & Compliance', roles: ['informationsbereitsteller'] },
  { id: 'u-petra-lindner', firstName: 'Petra', lastName: 'Lindner', userName: 'p.lindner', email: 'petra.lindner@escriba.de', platformUserId: '1043', active: true, primaryTeamId: 't-recht', primaryTeamName: 'Recht & Compliance', roles: ['complianceverantwortlicher'] },
  { id: 'u-julia-schneider', firstName: 'Julia', lastName: 'Schneider', userName: 'j.schneider', email: 'julia.schneider@escriba.de', platformUserId: '1044', active: true, primaryTeamId: 't-vertrieb-innen', primaryTeamName: 'Vertrieb Innendienst', roles: ['kenntnissnahmeempfaenger'] },
  { id: 'u-heiko-wendt', firstName: 'Heiko', lastName: 'Wendt', userName: 'h.wendt', email: 'heiko.wendt@escriba.de', platformUserId: '1045', active: false, primaryTeamId: 't-vertrieb-aussen', primaryTeamName: 'Vertrieb Außendienst', roles: ['kenntnissnahmeempfaenger'] }
];

export const MOCK_FOLDERS: InformationFolder[] = [
  {
    id: 'f-arbeitssicherheit',
    name: 'Arbeitssicherheit — Unterweisung 2026',
    shortName: 'AS-2026',
    description: 'Jährliche Unterweisung nach DGUV Vorschrift 1.',
    userInformation: 'Die Unterweisung zur Arbeitssicherheit wurde für 2026 überarbeitet. Bitte lesen Sie das Dokument vollständig und bestätigen Sie die Kenntnisnahme innerhalb der Frist.',
    documentCategory: 'Unterweisung',
    documentLanguage: ['de'],
    confidentialityLevel: 'Internal',
    status: 'Active',
    acknowledgmentStatus: 'Pending',
    deadlineDays: 14,
    responsibleTeamId: 't-recht',
    responsibleTeamName: 'Recht & Compliance',
    distributionListId: null,
    createdById: 'u-markus-bauer',
    primaryTeamId: 't-recht'
  },
  {
    id: 'f-datenschutz',
    name: 'Datenschutz-Richtlinie (DSGVO)',
    userInformation: 'Die Richtlinie wurde um die neuen Auftragsverarbeitungsregelungen ergänzt.',
    documentCategory: 'Richtlinie',
    documentLanguage: ['de', 'en'],
    confidentialityLevel: 'Confidential',
    status: 'Active',
    acknowledgmentStatus: 'Overdue',
    deadlineDays: 14,
    responsibleTeamId: 't-recht',
    responsibleTeamName: 'Recht & Compliance',
    createdById: 'u-petra-lindner',
    primaryTeamId: 't-recht'
  },
  {
    id: 'f-reisekosten',
    name: 'Reisekostenordnung',
    userInformation: 'Neufassung der Reisekostenordnung ab 2026.',
    documentCategory: 'Ordnung',
    documentLanguage: ['de'],
    confidentialityLevel: 'Internal',
    status: 'Draft',
    acknowledgmentStatus: 'None',
    deadlineDays: 21,
    responsibleTeamId: 't-personalwesen',
    responsibleTeamName: 'Personalwesen',
    createdById: 'u-markus-bauer',
    primaryTeamId: 't-recht'
  }
];

export const MOCK_VERSIONS: DocumentVersion[] = [
  { id: 'v-as-21', name: 'Unterweisung 2026, korrigierte Fassung', versionId: 'v2.1', informationFolderId: 'f-arbeitssicherheit', versionStatus: 'Active', validFrom: '2026-07-21T08:00:00Z', validUntil: null, totalDocumentCount: 2 },
  { id: 'v-as-20', name: 'Unterweisung 2026', versionId: 'v2.0', informationFolderId: 'f-arbeitssicherheit', versionStatus: 'Inactive', validFrom: '2026-06-12T08:00:00Z', validUntil: '2026-07-21T08:00:00Z', totalDocumentCount: 1 },
  { id: 'v-ds-14', name: 'Datenschutz-Richtlinie', versionId: 'v1.4', informationFolderId: 'f-datenschutz', versionStatus: 'Active', validFrom: '2026-07-16T08:00:00Z', validUntil: null, totalDocumentCount: 1 }
];

export const MOCK_ACKNOWLEDGEMENTS: Acknowledgement[] = [
  {
    id: 'a-1', caseNumber: 'ACK-2026-004182', acknowledgmentStatus: 'Overdue', deadlineDate: '2026-07-30',
    employee: 'Anna Vogt', userId: 'u-anna-vogt', email: 'anna.vogt@escriba.de',
    informationFolderId: 'f-datenschutz', informationFolderName: 'Datenschutz-Richtlinie (DSGVO)',
    documentVersionId: 'v-ds-14', documentVersionLabel: 'v1.4',
    userInformation: 'Die Richtlinie wurde um die neuen Auftragsverarbeitungsregelungen ergänzt. Betroffen sind alle Mitarbeitenden mit Zugriff auf Kundendaten.',
    responsibleTeam: 'Recht & Compliance', primaryTeamId: 't-personalwesen'
  },
  {
    id: 'a-2', caseNumber: 'ACK-2026-004183', acknowledgmentStatus: 'Pending', deadlineDate: '2026-08-04',
    employee: 'Anna Vogt', userId: 'u-anna-vogt', email: 'anna.vogt@escriba.de',
    informationFolderId: 'f-arbeitssicherheit', informationFolderName: 'Arbeitssicherheit — Unterweisung 2026',
    documentVersionId: 'v-as-21', documentVersionLabel: 'v2.1',
    userInformation: 'Die jährliche Unterweisung zur Arbeitssicherheit wurde für 2026 überarbeitet. Bitte lesen Sie das Dokument vollständig.',
    responsibleTeam: 'Recht & Compliance', primaryTeamId: 't-personalwesen'
  },
  {
    id: 'a-3', caseNumber: 'ACK-2026-003901', acknowledgmentStatus: 'Obsolete', deadlineDate: '2026-07-02',
    employee: 'Anna Vogt', userId: 'u-anna-vogt',
    informationFolderId: 'f-reisekosten', informationFolderName: 'Reisekostenordnung',
    documentVersionId: 'v-as-20', documentVersionLabel: 'v2.0',
    userInformation: 'Neufassung der Reisekostenordnung.', primaryTeamId: 't-personalwesen'
  },
  {
    id: 'a-4', caseNumber: 'ACK-2026-004190', acknowledgmentStatus: 'Overdue', deadlineDate: '2026-07-30',
    employee: 'Julia Schneider', userId: 'u-julia-schneider', email: 'julia.schneider@escriba.de',
    informationFolderId: 'f-datenschutz', informationFolderName: 'Datenschutz-Richtlinie (DSGVO)',
    documentVersionId: 'v-ds-14', documentVersionLabel: 'v1.4',
    userInformation: 'Die Richtlinie wurde um die neuen Auftragsverarbeitungsregelungen ergänzt.',
    primaryTeamId: 't-vertrieb-innen'
  }
];

export const MOCK_ORG_UNIT_LINKS: OrganizationalUnitLink[] = [
  { id: 'ou-1', informationFolderId: 'f-arbeitssicherheit', teamId: 't-personalwesen', includeTeamHierarchy: false },
  { id: 'ou-2', informationFolderId: 'f-arbeitssicherheit', teamId: 't-vertrieb', includeTeamHierarchy: true },
  { id: 'ou-3', informationFolderId: 'f-arbeitssicherheit', teamId: 't-vertrieb-innen', includeTeamHierarchy: false, addedByHierarchy: true }
];

export const MOCK_TEMPLATES: DistributionTemplate[] = [
  { id: 'dl-dach', name: 'Alle Standorte DACH', userIds: ['u-anna-vogt'], teams: [{ teamId: 't-vertrieb', includeTeamHierarchy: true }, { teamId: 't-it', includeTeamHierarchy: true }], resolvedPeopleCount: 213, usedByFolderCount: 7 },
  { id: 'dl-leads', name: 'Führungskräfte', userIds: [], teams: [{ teamId: 't-recht', includeTeamHierarchy: false }], resolvedPeopleCount: 38, usedByFolderCount: 4 }
];
