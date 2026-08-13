import { AckStatus, Confidentiality, FolderStatus, ProcessingStatus } from './enums';

/** Object 2a4119b3… — field names match the tenant configuration. */
export interface InformationFolder {
  id: string;
  information_folder_textfield_name: string;
  information_folder_textfield_short_name?: string;
  information_folder_textfield_description?: string;
  /** Rich text. Required. Copied onto every acknowledgement. */
  information_folder_richtext_area_user_information: string;
  information_folder_textfield_document_category?: string;
  information_folder_multi_select_picklist_document_language?: string[];
  information_folder_picklist_confidentiality_level: Confidentiality;
  information_folder_picklist_status: FolderStatus;
  /** Computed roll-up. Never written from the UI. */
  information_folder_picklist_acknowledgment_status: AckStatus;
  information_folder_picklist_processing_status?: ProcessingStatus;
  information_folder_number_deadlinedays: number;
  information_folder_lookup_responsible_team: string;
  /** Display-only — the real name for the id above, read off the same {name, id} shape as created_id/modified_id. Never sent back on writes. */
  responsibleTeamName?: string;
  /** The real Information Manager Teams x Users junction row id backing the display name above — needed to preselect a team picker. */
  responsibleTeamId?: string;
  /** Write-only trigger — cleared by the server after the template is applied. */
  information_folder_lu_distribution_list?: string | null;
  information_folder_text_field_userid?: string;
  information_folder_text_field_primary_team_id?: string;
  created_id?: string;
  date_created?: string;
  date_modified?: string;
}
