/** AgileApps object ids for the labs_dev tenant. */
export const OBJECT_ID = {
  informationFolder: '2a4119b3fb1c4f0c8d822187d363b369',
  documentVersion: '500b9642974f4b1fb6a44637aaf3c773',
  acknowledgement: '6b02c95a2ccd406caaec3a4b921e7897',
  users: 'dad21150dc4c4c378819d3ae5f4218e8',
  teams: '2a4456b159cc4b2abef60d969dbc72a7',
  distributionTemplate: '45aed8d75ae542179befff2799f36532',
  organizationalUnits: 'e3fa768f968d4b8aaaffca8c7756bcd2',
  embeddings: '00185826246544438e3a93aa4beb17ef',
  /** Junction object (Information Manager Teams x Information Manager Users) — the real lookup target of information_folder_lookup_responsible_team, not the plain system Team object. */
  informationManagerTeamsUsers: '2390c38b2ffe45feab68d882cc2a0105',
  /** "Employees" in the ECAP UI — real object name Information_Manager_Users_Information_Folder, the Folder<->User junction (parallel to organizationalUnits, which is Folder<->Team). */
  employees: 'f7a2f8d2498a447e916cd6fb04c4fa0f'
} as const;

export const APP_ID = 'c9dc4519082748d88f2ddbb1e3489f17';
export const API_BASE = '/networking/rest';

/** ECAP view ids for the Information Folder object (2a4119b3fb1c4f0c8d822187d363b369), mapped to the folder-list tabs. */
/**
 * ECAP role record ids for the Information Manager app, confirmed by the user 2026-08-07.
 * 'administrator' has no corresponding UI role in this app (see Role type) — kept for reference only.
 */
export const ROLE_ID = {
  administrator: '4ad4fd633d0d45ecb9962ff966fb413c',
  complianceverantwortlicher: 'db97d55d393e4908a6ffaa97b78318d6',
  informationsbereitsteller: 'c73d50987be1487bb7b3f76e4d11f54c',
  kenntnissnahmeempfaenger: '6d3bffcfdc2d40258d8855a18ac64f93'
} as const;

/** "Default Layout" — the only record_access_form assigned to any role on Information Folder. Confirmed by the user 2026-08-07. */
export const INFORMATION_FOLDER_LAYOUT_ID = 'a9537de41a564bf790983af4fcc5b2a5';

/** "Default Layout" on the Organizational Units child object (informationfolder_record / informationmanagerteams_record / imt_if_check_box_include_team_hierarchy). Confirmed live via ecap-agent 2026-08-08. */
export const ORGANIZATIONAL_UNIT_LAYOUT_ID = '54c2b16b7f1943b68579c618792e5a98';

/** "Default Layout" on the Employees child object (informationfolder_record / informationmanagerusers_record). Confirmed live via ecap-agent 2026-08-08. */
export const EMPLOYEE_LAYOUT_ID = '485853570a91497eb6e8d18da1c92ccb';

/** "Default Layout" on Document Version. Confirmed live via ecap-agent 2026-08-08. */
export const DOCUMENT_VERSION_LAYOUT_ID = 'ab00e8f02d2a47eb992db5f71d5a105e';

/** "Activate Document Version" macro id on Document Version. Confirmed live via network capture 2026-08-08. */
export const DOCUMENT_VERSION_ACTIVATE_MACRO_ID = 'ecee080649ca4ffea437b650d0811f89';

/**
 * "Activate/Deactivate Information Folder" macro ids. Both objects' macros are invoked the
 * same way: POST rest/record/{objectId}/{recordId}/execMacro/{macroId} — the
 * rest/macro/{camelCaseSlug}/{recordId} shape used earlier for these two was an unverified
 * guess (matched the observed naming convention but was never captured live) and 404s for
 * real; execMacro is the one real pattern confirmed by network capture, on Document Version's
 * own Activate macro.
 */
export const INFORMATION_FOLDER_ACTIVATE_MACRO_ID = 'e62c33cad67349c2a2b656100159c986';
export const INFORMATION_FOLDER_DEACTIVATE_MACRO_ID = '7f4b65fb36174704838ea0f0e1dee1ca';

/**
 * Information Folder's "Versions" related-section id (its Default Layout's related-list
 * widget listing Document Version records). Confirmed live: native ECAP loads this via
 * solution/ServiceDesk/relatedObjectList?record_id={folderId}&p_objectId={informationFolder}
 * &related_section_id={this}&paginationRequired=true&page=1&pageSize=...&sortBy=date_modified
 * &sortOrder=desc — NOT the generic rest/record/{oid}?filter=... list endpoint, which this
 * tenant has shown to be unreliable independent of retries/page size for reasons that don't
 * reproduce via the same object through this endpoint. Rows come back under
 * response[this].relatedInfoData, with plain-string (not {displayValue,content}-wrapped)
 * picklist values — a different serialization convention than the generic REST endpoint.
 */
export const INFORMATION_FOLDER_VERSIONS_SECTION_ID = '179b1153dbd744a0a62b09220f4662e9';

/** Document Version's "Acknowledgement (Document Version)" related-section id — same relatedObjectList family, confirmed live via network capture. */
export const DOCUMENT_VERSION_ACKNOWLEDGEMENT_SECTION_ID = 'aa9ce924d8b0401f8bf6cbc28faae698';

/**
 * Acknowledgement's real saved views, confirmed live via ecap-agent (2026-08-09). Used with the
 * same libEcapRuntimeRecordList / ListDataPage mechanism as INFORMATION_FOLDER_VIEW_ID — the
 * generic rest/record/{oid}?filter=... list endpoint proved unreliable for this object
 * (deterministic 0-row responses despite a correct totalRecordCount, at every page size
 * tried), while ListDataPage reliably returned real rows on every attempt.
 */
export const ACKNOWLEDGEMENT_VIEW_ID = {
  myPending: 'aba92667449a49c8ab0510f01b58842b',
  myOverdue: 'fe352c0f4acc469f80d1c3120eae09a8',
  myCompleted: 'dae5f37dcd1b4d49804a715fa121ce58',
  myObsolete: 'd3f11f96d76b482287939bc5e359ef72',
  assignedToUsers: '2725382d3fb9495a948b1b1624a9d4f5',
  /** "ALL ACKNOWLEDGEMENTS for CUI" — a real view purpose-built for this app (confirmed live
   *  via network capture), unlike the object's own generic '0' view which has no usable columns.
   *  Row visibility is still enforced server-side by the object's own ACL, so Compliance sees
   *  every record through this view while other roles see only their own scoped subset. */
  allForCui: '71f36b8fc6d2460e85f961bc221e91f0',
  /**
   * Three views built specifically for the Compliance officer's own Pending/Overdue/Done
   * tabs on chase-table.component.ts — confirmed live via network capture of each view's own
   * ListDataPage response (2026-08-13). Deliberately separate from myPending/myOverdue/
   * myCompleted above: those are scoped to the current user's own acknowledgements, wrong for
   * an oversight role that needs to see every pending/overdue/completed record tenant-wide.
   * Information Provider keeps using myPending/myOverdue/myCompleted unchanged.
   */
  compliancePending: '5f33ef9ba04542ce97652a6384e702ac',
  complianceOverdue: '285005e8308041f6a3100d0e0f8e9a77',
  complianceCompleted: '8993a126d0194899bfc6252c323ce996'
} as const;

export const INFORMATION_FOLDER_VIEW_ID = {
  myActive: 'e52b385adefa475aa3b1d006ada27589',
  myDraft: '53ccbc1fe7464b5bb340e26f6fa450dc',
  myInactive: '2b36b2f86b184530b45bea7f554959a5',
  teamsActive: '390ae5606e0f46108ba6656008e0ade0',
  teamsDraft: 'c852b2fef2264cc49fc4901ef3b364c2',
  teamsInactive: '395d337358a24f6c86ca26ee3e1c408c',
  /** A real, distinct "All Records" view (confirmed live: 32 real rows, real columns) — not the
   *  object's generic id-'0' sentinel, which only returns id/name/date fields. */
  allRecords: '01e80a1a393a4703b250306cda5b1858'
} as const;
