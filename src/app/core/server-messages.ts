/** Verbatim strings thrown by the tenant's Java classes. Do not paraphrase. */
export const SERVER_MESSAGE = {
  nonPdf: (filename: string) => `Operation Failed: Only PDF files are allowed. Uploaded file: ${filename}`,
  recipientForbidden: 'Operation Failed: Information Receiver role is not allowed to perform this action.',
  duplicateViaParent: (team: string, parent: string) =>
    `The team '${team}' has already been included because of the parent team '${parent}' selected with hierarchy. Please delete ${team} Team from organizational units`,
  duplicateTeam: (team: string) => `The team '${team}' is already linked to this Information Folder.`,
  syncNoVersion: (id: string) =>
    `Sync aborted: no Active Document Version found for folder ID: ${id}. Ensure an active version exists before triggering a sync.`,
  syncNoUsers: (id: string) =>
    `Sync aborted: no users found for folder ID: ${id}. Ensure at least one user or team is linked to this folder before triggering a sync.`,
  activationNeedsVersion: 'At least one Document Version is required to activate'
} as const;
