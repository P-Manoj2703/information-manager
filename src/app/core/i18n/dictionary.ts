export type Lang = 'de' | 'en';

/** DE primary, EN secondary — matching the tenant's bilingual email subjects. */
export const DICT = {
  appName:            ['Information Manager', 'Information Manager'],
  myAcknowledgements: ['Meine Kenntnisnahmen', 'My acknowledgements'],
  documents:          ['Dokumente', 'Documents'],
  folders:            ['Informationsordner', 'Information folders'],
  informationFolder:  ['Informationsordner', 'Information folder'],
  acknowledgements:   ['Kenntnisnahmen', 'Acknowledgements'],
  acknowledgement:    ['Kenntnisnahme', 'Acknowledgement'],
  templates:          ['Verteilervorlagen', 'Distribution templates'],
  estate:             ['Übersicht', 'Estate overview'],
  users:              ['Benutzer', 'Users'],
  teams:              ['Teams', 'Teams'],
  monitoring:         ['Monitoring', 'Monitoring'],

  pending:  ['Offen', 'Pending'],
  overdue:  ['Überfällig', 'Overdue'],
  done:     ['Erledigt', 'Done'],
  obsolete: ['Nicht mehr erforderlich', 'Obsolete'],
  draft:    ['Entwurf', 'Draft'],
  active:   ['Aktiv', 'Active'],
  inactive: ['Inaktiv', 'Inactive'],

  deadline:        ['Frist', 'Deadline'],
  version:         ['Version', 'Version'],
  status:          ['Status', 'Status'],
  confirmButton:   ['Kenntnisnahme bestätigen', 'Confirm acknowledgement'],
  commentOptional: ['Kommentar (optional)', 'Comment (optional)'],
  perVersionNote:  ['Die Kenntnisnahme gilt für diese Version. Bei einer neuen Version werden Sie erneut gefragt.',
                    'Acknowledgement applies to this version. A new version asks you again.'],
  yourTask:        ['IHRE AUFGABE', 'YOUR TASK'],
  messageFrom:     ['NACHRICHT DES HERAUSGEBERS', 'MESSAGE FROM THE PUBLISHER'],
  downloadAll:     ['Alle Dateien laden', 'Download all files'],
  resolvesTo:      ['ERGIBT', 'RESOLVES TO'],
  people:          ['Personen', 'people'],
  remindNow:       ['Erinnern', 'Remind'],
  override:        ['Status ändern', 'Override'],
  reasonRequired:  ['BEGRÜNDUNG (PFLICHT)', 'REASON (REQUIRED)'],
  newVersion:      ['Neue Version', 'New version'],
  editPublished:   ['Veröffentlichten Ordner ändern', 'Edit published folder'],
  pdfOnly:         ['Nur PDF. Andere Formate werden serverseitig abgelehnt.', 'PDF only. Other formats are rejected by the server.']
} as const satisfies Record<string, readonly [string, string]>;

export type DictKey = keyof typeof DICT;
