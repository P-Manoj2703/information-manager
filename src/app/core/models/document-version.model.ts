import { VersionStatus } from './enums';

/** Object 500b9642… — reconstructed from the Default Layout (see brief §12). */
export interface DocumentVersion {
  id: string;
  document_version_textfield_name: string;
  version_text_field_version_id: string;
  informationfolder_record: string;
  version_picklist_version_status: VersionStatus;
  version_textarea_description?: string;
  version_date_time_valid_from?: string | null;
  version_date_time_valid_until?: string | null;
  /** Maintained by server code on file add/remove. Read-only in the UI. */
  version_number_total_document_count: number;
  version_text_field_primary_team_id?: string;
}
