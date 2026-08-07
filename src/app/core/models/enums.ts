export type FolderStatus = 'Draft' | 'Active' | 'Inactive';
export type VersionStatus = 'Draft' | 'Active' | 'Inactive';
export type AckStatus = 'None' | 'Pending' | 'Overdue' | 'Done' | 'Obsolete';
export type ProcessingStatus = 'Unprocessed changes' | 'Processing changes' | 'Changes processed';
export type Confidentiality = 'Internal' | 'Public' | 'Confidential';

export type Role =
  | 'informationsbereitsteller'
  | 'kenntnissnahmeempfaenger'
  | 'complianceverantwortlicher';
