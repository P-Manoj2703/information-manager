import { InformationFolder } from './models';

type FolderField = keyof InformationFolder;

const ALWAYS_REQUIRED: FolderField[] = [
  'information_folder_picklist_confidentiality_level',
  'information_folder_number_deadlinedays',
  'information_folder_textfield_name',
  'information_folder_lookup_responsible_team',
  'information_folder_picklist_status',
  'information_folder_richtext_area_user_information'
];

const HIDDEN_ALWAYS: FolderField[] = [
  'information_folder_picklist_acknowledgment_status',
  'information_folder_picklist_processing_status',
  'information_folder_text_field_userid',
  'information_folder_text_field_primary_team_id'
];

const EDITABLE_IN_DRAFT: FolderField[] = [
  'information_folder_picklist_confidentiality_level',
  'information_folder_number_deadlinedays',
  'information_folder_textfield_description',
  'information_folder_textfield_document_category',
  'information_folder_multi_select_picklist_document_language',
  'information_folder_textfield_name',
  'information_folder_textfield_short_name',
  'information_folder_richtext_area_user_information'
];

const EDITABLE_WHEN_INACTIVE: FolderField[] = [
  ...EDITABLE_IN_DRAFT,
  'information_folder_lookup_responsible_team'
];

export const isRequired = (f: FolderField) => ALWAYS_REQUIRED.includes(f);
export const isHidden = (f: FolderField) => HIDDEN_ALWAYS.includes(f);

const EDITABLE_WHEN_ACTIVE: FolderField[] = [
  'information_folder_textfield_description',
  'information_folder_number_deadlinedays'
];

/**
 * Dynamic form rules of the Default Layout.
 * Active ⇒ only Description and Deadline are editable via "Edit published folder".
 * Every other field still requires deactivate → edit → activate.
 */
export function isFieldEditable(folder: InformationFolder, field: FolderField): boolean {
  if (isHidden(field)) return false;
  switch (folder.information_folder_picklist_status) {
    case 'Draft': return EDITABLE_IN_DRAFT.includes(field);
    case 'Inactive': return EDITABLE_WHEN_INACTIVE.includes(field);
    case 'Active': return EDITABLE_WHEN_ACTIVE.includes(field);
  }
}

/** Validation: "At least one Document Version is required to activate". */
export function canActivate(folder: InformationFolder, versionCount: number): { ok: boolean; reason?: string } {
  if (versionCount === 0) return { ok: false, reason: 'At least one Document Version is required to activate' };
  return { ok: true };
}

/** Delete is only offered while Draft; otherwise the UI offers Deactivate. */
export const canDelete = (folder: InformationFolder) => folder.information_folder_picklist_status === 'Draft';
