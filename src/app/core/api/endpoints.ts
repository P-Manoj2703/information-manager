/** AgileApps / ECAP REST endpoints. Object ids come from the tenant configuration. */
export const OBJECT_IDS = {
  informationFolder: '2a4119b3fb1c4f0c8d822187d363b369',
  documentVersion: '500b9642974f4b1fb6a44637aaf3c773',
  acknowledgement: '6b02c95a2ccd406caaec3a4b921e7897',
  users: 'dad21150dc4c4c378819d3ae5f4218e8',
  teams: '2a4456b159cc4b2abef60d969dbc72a7',
  distributionTemplate: '45aed8d75ae542179befff2799f36532',
  organizationalUnits: 'e3fa768f968d4b8aaaffca8c7756bcd2',
  embeddings: '00185826246544438e3a93aa4beb17ef'
} as const;

export const ENDPOINTS = {
  records: (objectId: string) => `/networking/rest/record/${objectId}`,
  record: (objectId: string, recordId: string) => `/networking/rest/record/${objectId}/${recordId}`,
  /** Custom form action downloadAllFiles — pulls the whole DMS folder in one request. */
  downloadAllFiles: (objectId: string, recordId: string, folderId: string) =>
    `/networking/rest/dms/${objectId}/${recordId}/folder/${folderId}/download`,
  /** Macros defined on the objects. */
  macroActivateFolder: (recordId: string) => `/networking/rest/macro/activateInformationFolder/${recordId}`,
  macroDeactivateFolder: (recordId: string) => `/networking/rest/macro/deactivateInformationFolder/${recordId}`,
  macroActivateVersion: (recordId: string) => `/networking/rest/macro/activateDocumentVersion/${recordId}`,
  /** BPM task list; completing the task is what sets the acknowledgement to Done. */
  tasks: '/networking/rest/task',
  completeTask: (taskId: string) => `/networking/rest/task/${taskId}/complete`,
  /** External Angular monitoring app, embedded as a web tab. */
  monitoringApp: 'https://labs-dev.ecap-epm.de/networking/apps/labs/information-manager/'
} as const;
