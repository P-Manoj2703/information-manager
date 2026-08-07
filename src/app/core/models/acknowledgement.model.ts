import { AckStatus } from './enums';

/** Object 6b02c95a… — one row per (person × active version). */
export interface Acknowledgement {
  id: string;
  acknowledgment_picklist_status: AckStatus;
  acknowledgement_date_deadline_date: string;
  acknowledgment_textfield_employee: string;
  acknowledgement_lookup_user: string;
  acknowledgment_email_address_email: string;
  acknowledgement_lookup_information_folder: string;
  acknowledgement_textfield_information_folder_name: string;
  documentversion_record: string;
  acknowledgement_textfield_responsible_team?: string;
  /** The message the recipient reads. Hidden by the tenant form rule — shown in this UI. */
  acknowledgment_richtextarea_user_information: string;
  acknowledgement_text_field_primary_team_id?: string;
  case_number?: string;
  /** Id of the BPM user task of the Acknowledgment Completion Process. */
  taskId?: string;
}
