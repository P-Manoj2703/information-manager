import { Component, EventEmitter, Output, computed, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { EMPLOYEE_LAYOUT_ID, OBJECT_ID, ORGANIZATIONAL_UNIT_LAYOUT_ID } from '@core/objects';
import { DistributionTemplateOption, TemplatePickerComponent } from './template-picker.component';

/** One row of the Information Manager Teams custom object (2a4456b159cc4b2abef60d969dbc72a7) — NOT the system Team object. */
interface OrgTeam { id: string; name: string; parentId: string; }

/** One row of the Information Manager Users custom object (dad21150dc4c4c378819d3ae5f4218e8) — NOT the raw system User. */
interface OrgUser { id: string; label: string; }

/** One real, already-persisted row from the Organizational Units child object. */
interface LinkedOrgUnit {
  recordId: string; teamId: string; teamName: string; includeTeamHierarchy: boolean;
  lastModifiedTimestamp: string;
}

/** One real, already-persisted row from the Employees child object (Folder<->User junction). */
interface LinkedEmployee { recordId: string; userId: string; userLabel: string; }

/**
 * Mirrors InformationFolderUtil.isCheckboxActive (Java) exactly — confirmed from the tenant's
 * own indexed class source: `val.equals("1") || val.equalsIgnoreCase("true") || val.equalsIgnoreCase("Yes")`.
 * ECAP checkbox fields round-trip as the string "1"/"0" (confirmed on other objects in this
 * tenant), not JSON true/false — reading with a strict `=== true` check silently treats a
 * genuinely-active checkbox as off.
 */
function isCheckboxActive(val: unknown): boolean {
  if (val == null) return false;
  const s = String(val);
  return s === '1' || s.toLowerCase() === 'true' || s.toLowerCase() === 'yes';
}

/**
 * UC-IP-02 / UC-ADM-03. One panel for the three mechanisms the platform keeps
 * apart (teams subform, users subform, template lookup) — all three wired to
 * real ECAP data:
 *
 * - Organisational units / Users: each add/remove is an immediate
 *   RecordCreate/DELETE against the Organizational Units / Employees child
 *   objects, matching ECAP's own subforms (persist per-row, not staged until
 *   a page-level save). Hierarchy expansion and acknowledgement creation
 *   happen server-side via ECAP's own rules once the record is created; this
 *   component does not replicate that logic.
 * - Distribution Template: every folder gets its own "Distribution Template"
 *   BPM task on creation. Applying a template saves it onto the folder's
 *   information_folder_lu_distribution_list field, then completes that task —
 *   completion is what triggers DistributionListAttachingHandler server-side
 *   (confirmed live via network capture of the native task button; an
 *   earlier DistributionListAttachController.jsp endpoint referenced in this
 *   app's own JSP source turned out to be dead/undeployed code, not what the
 *   native UI actually calls).
 */
@Component({
  selector: 'im-audience-builder',
  standalone: true,
  imports: [TemplatePickerComponent],
  styleUrl: './audience-builder.component.scss',
  template: `
    <section class="card">
      <div class="layout">
        <div class="main">
          <header class="head">
            <div>
              <h2>{{ lang.isGerman() ? 'Zielgruppe' : 'Audience' }}</h2>
              <p>{{ lang.isGerman()
                ? 'Teams, einzelne Personen und Verteilervorlagen an einer Stelle.'
                : 'Teams, individual people and distribution templates in one place.' }}</p>
            </div>
            <div class="stats" aria-live="polite">
              <div class="stat">
                <span class="eyebrow">{{ lang.isGerman() ? 'Organisationseinheiten' : 'Organisational units' }}</span>
                <strong>{{ linkedOrgUnits().length }}</strong>
              </div>
              <div class="stat">
                <span class="eyebrow">{{ lang.t('users') }}</span>
                <strong>{{ linkedEmployees().length }}</strong>
              </div>
            </div>
          </header>

          <div class="panels">
            <div class="panel">
          <header>
            <span class="panel__title">{{ lang.isGerman() ? 'Organisationseinheiten' : 'Organisational units' }}
              <span class="panel__count">{{ linkedOrgUnits().length }}</span></span>
            <button type="button" class="plus-btn" (click)="showTeamPicker.set(!showTeamPicker())">
              <span class="plus">+</span> {{ lang.isGerman() ? 'Hinzufügen' : 'Add' }}
            </button>
          </header>

          @if (orgUnitError()) { <p class="error">{{ orgUnitError() }}</p> }

          @for (u of topLevelOrgUnits(); track u.recordId) {
            <div class="row">
              <div class="row__main">
                <div class="row__name">
                  <strong>{{ u.teamName }}</strong>
                  <small>
                    @if (u.includeTeamHierarchy) {
                      {{ memberCountFor(u.teamId) }} {{ lang.isGerman() ? 'direkt' : 'direct' }}
                      @if (subTeamMemberCount(u.teamId)) {
                        · {{ subTeamMemberCount(u.teamId) }} {{ lang.isGerman() ? 'aus Unterteams' : 'from sub-teams' }}
                      }
                    } @else {
                      {{ memberCountFor(u.teamId) }} {{ lang.isGerman() ? 'Mitglieder' : 'members' }}
                    }
                  </small>
                </div>
                <label class="switch switch--locked" [attr.title]="lang.isGerman() ? 'Nur bei Hinzufügen wählbar' : 'Only selectable when adding'">
                  <input type="checkbox" class="switch__input" [checked]="u.includeTeamHierarchy" disabled>
                  <span class="switch__track" [class.switch__track--on]="u.includeTeamHierarchy">
                    <span class="switch__thumb"></span>
                  </span>
                  <span class="switch__label">{{ lang.isGerman() ? 'Hierarchie' : 'Hierarchy' }}</span>
                </label>
                <button type="button" class="x" (click)="removeOrgUnit(u.recordId)" aria-label="remove">×</button>
              </div>
              @if (u.includeTeamHierarchy && linkedDescendantsOf(u.teamId).length) {
                <ul class="tree">
                  @for (c of linkedDescendantsOf(u.teamId); track c.id) {
                    <li>
                      <span>{{ c.name }}</span>
                      <span class="tree__count">{{ lang.isGerman() ? 'auto-verknüpft' : 'auto-linked' }} · {{ memberCountFor(c.id) }}</span>
                    </li>
                  }
                </ul>
              }
            </div>
          }

          @if (showTeamPicker()) {
            <div class="picker">
              <input type="text" class="lookup__input" [value]="teamQuery()"
                     (input)="teamQuery.set($any($event.target).value)"
                     [placeholder]="lang.isGerman() ? 'Team suchen…' : 'Search teams…'">
              <label class="switch">
                <input type="checkbox" class="switch__input" [checked]="newUnitIncludeHierarchy()"
                       (change)="newUnitIncludeHierarchy.set(!newUnitIncludeHierarchy())">
                <span class="switch__track"><span class="switch__thumb"></span></span>
                <span class="switch__label">{{ lang.isGerman() ? 'Team-Hierarchie einschließen' : 'Include team hierarchy' }}</span>
              </label>
              @if (orgTeamsLoading()) {
                <span class="lookup__empty">{{ lang.isGerman() ? 'Teams werden geladen…' : 'Loading teams…' }}</span>
              }
              <div class="add">
                @for (t of addableRealTeams(); track t.id) {
                  <button type="button" (click)="addOrgUnit(t.id, t.name)">+ {{ t.name }}</button>
                } @empty {
                  @if (!orgTeamsLoading() && teamQuery().trim()) {
                    <span class="lookup__empty">{{ lang.isGerman() ? 'Keine Teams gefunden' : 'No teams found' }}</span>
                  }
                }
              </div>
            </div>
          }
        </div>

        <div class="panel">
          <header>
            <span class="panel__title">{{ lang.t('users') }}
              <span class="panel__count">{{ linkedEmployees().length }}</span></span>
            <button type="button" class="plus-btn" (click)="showUserPicker.set(!showUserPicker())">
              <span class="plus">+</span> {{ lang.isGerman() ? 'Hinzufügen' : 'Add' }}
            </button>
          </header>

          @if (employeeError()) { <p class="error">{{ employeeError() }}</p> }

          @if (showUserPicker()) {
            <div class="picker">
              <input type="text" class="lookup__input" [value]="userQuery()"
                     (input)="userQuery.set($any($event.target).value)"
                     [placeholder]="lang.isGerman() ? 'Person suchen…' : 'Search people…'">
              @if (orgUsersLoading()) {
                <span class="lookup__empty">{{ lang.isGerman() ? 'Personen werden geladen…' : 'Loading people…' }}</span>
              }
              <div class="lookup__results">
                @for (u of addableRealUsers(); track u.id) {
                  <button type="button" (click)="addEmployee(u.id, u.label)">+ {{ u.label }}</button>
                } @empty {
                  @if (!orgUsersLoading() && userQuery().trim()) {
                    <span class="lookup__empty">{{ lang.isGerman() ? 'Keine Treffer' : 'No matches' }}</span>
                  }
                }
              </div>
            </div>
          }

          <div class="roster">
            @for (e of linkedEmployees(); track e.recordId) {
              <div class="person">
                <div class="person__id">
                  <span class="person__name">{{ e.userLabel }}</span>
                </div>
                <button type="button" class="x" (click)="removeEmployee(e.recordId)" aria-label="remove">×</button>
              </div>
            }
          </div>
          </div>
        </div>
        </div>

        <aside class="sidebar">
          @if (templateError()) { <p class="error">{{ templateError() }}</p> }
          @if (templateApplying()) {
            <p class="hint">{{ lang.isGerman() ? 'Wird angewendet…' : 'Applying…' }}</p>
          }
          <im-template-picker [templates]="templates()" [appliedIds]="appliedTemplateIds()"
                               [loading]="templatesLoading()" (apply)="applyTemplate($event)" (remove)="removeTemplate($event)" />
        </aside>
      </div>

      <footer><button class="primary" (click)="save()">{{ lang.isGerman() ? 'Weiter' : 'Continue' }}</button></footer>
    </section>
  `
})
export class AudienceBuilderComponent {
  private readonly http = inject(HttpClient);
  readonly lang = inject(LanguageService);

  readonly folderId = input<string>('');
  @Output() readonly continue = new EventEmitter<{ teamCount: number; userCount: number }>();

  readonly teamQuery = signal('');
  readonly userQuery = signal('');
  readonly appliedTemplateIds = signal<string[]>([]);
  /** templateId -> exactly the org-unit/employee recordIds that template's apply created (same-session only, see removeTemplate). */
  private readonly templateCreatedRecords = signal<Map<string, { orgUnitRecordIds: string[]; employeeRecordIds: string[] }>>(new Map());
  readonly showTeamPicker = signal(false);
  readonly showUserPicker = signal(false);
  readonly newUnitIncludeHierarchy = signal(false);

  readonly templateError = signal('');
  readonly templateApplying = signal(false);
  readonly templatesLoading = signal(true);
  /**
   * Distribution_Lists (45aed8d75ae542179befff2799f36532) — real reusable audience templates.
   *
   * Confirmed live (via direct filter-by-name lookups, not just pagination) that several
   * specific records in this tenant — "Cyber security team", "Template team", "DL8", "DL5"
   * at minimum — exist (ECAP's own total count includes them) but can never be returned by
   * this REST endpoint, individually or paginated, with 0% success across repeated attempts.
   * This is a genuine data-integrity problem with those specific ECAP records (most likely a
   * dangling lookup reference crashing the server's own response serialization), not a
   * flakiness/timing issue retries can fix. A smaller page size (5, vs. the 20 used for
   * Teams/Users) at least reliably retrieves every OTHER, non-corrupted record instead of
   * the whole page silently failing when a broken record shares it with good ones.
   */
  readonly templates = toSignal(
    this.fetchAllPaged<DistributionTemplateOption>(
      OBJECT_ID.distributionTemplate,
      'id,distribution_list_tf_distribution_list_name',
      (r): DistributionTemplateOption => ({ id: r.id, name: r.distribution_list_tf_distribution_list_name ?? '' }),
      5
    ).pipe(map((templates) => { this.templatesLoading.set(false); return templates; })),
    { initialValue: [] as DistributionTemplateOption[] }
  );

  readonly linkedOrgUnits = signal<LinkedOrgUnit[]>([]);
  readonly orgUnitError = signal('');
  readonly orgTeamsLoading = signal(true);
  /**
   * Information Manager Teams (2a4456b159cc4b2abef60d969dbc72a7) — a custom object that
   * mirrors the system Team tree, and is the real lookup target of
   * informationmanagerteams_record.
   *
   * This REST endpoint (LOOKUP.TABLEDATA) is confirmed flaky on this tenant: identical
   * repeated requests sometimes return a full page and sometimes silently truncate
   * it, with no error — not a fixed row/byte cap (empirically it flips between full
   * and partial at the exact same pageSize across separate calls). fetchAllPaged
   * below retries any page that comes back short of what the reported
   * totalRecordCount says should still be available, up to a bounded number of
   * attempts, and stops once every record has been collected or the retry budget
   * is exhausted. Same pattern reused for the Users object below.
   */
  private readonly orgTeams = toSignal(
    this.fetchAllPaged<OrgTeam>(
      OBJECT_ID.teams,
      'id,name,information_manager_teams_lookup_self_referencing',
      (r): OrgTeam => ({ id: r.id, name: r.name, parentId: r.information_manager_teams_lookup_self_referencing?.content ?? '' })
    ).pipe(map((teams) => { this.orgTeamsLoading.set(false); return teams; })),
    { initialValue: [] as OrgTeam[] }
  );
  /** id -> direct children, from information_manager_teams_lookup_self_referencing (a real parent pointer within this same object — not the system Team's own parent field). */
  private readonly orgTeamChildren = computed(() => {
    const byParent = new Map<string, OrgTeam[]>();
    this.orgTeams().forEach((t) => {
      if (!t.parentId || t.parentId === t.id) return;
      byParent.set(t.parentId, [...(byParent.get(t.parentId) ?? []), t]);
    });
    return byParent;
  });

  readonly linkedEmployees = signal<LinkedEmployee[]>([]);
  readonly employeeError = signal('');
  readonly orgUsersLoading = signal(true);
  /** Information Manager Users (dad21150dc4c4c378819d3ae5f4218e8) — a custom object mirroring the system User, NOT the raw system User itself. */
  private readonly orgUsers = toSignal(
    this.fetchAllPaged<OrgUser>(
      OBJECT_ID.users,
      'id,information_manager_user_text_field_first_name,information_manager_user_text_field_last_name,information_manager_user_email_address_email',
      (r): OrgUser => {
        const first = r.information_manager_user_text_field_first_name ?? '';
        const last = r.information_manager_user_text_field_last_name ?? '';
        const email = r.information_manager_user_email_address_email ?? '';
        const name = `${first} ${last}`.trim();
        return { id: r.id, label: name ? `${name} (${email})` : email };
      }
    ).pipe(map((users) => { this.orgUsersLoading.set(false); return users; })),
    { initialValue: [] as OrgUser[] }
  );

  private static readonly PAGE_SIZE = 20;
  private static readonly MAX_PAGES = 8;
  private static readonly MAX_RETRIES_PER_PAGE = 5;

  /**
   * Fetches one page, retrying while it comes back short of pageSize (including a
   * completely empty page — confirmed live that this endpoint can return
   * recordCount:0 with the correct nonzero totalRecordCount, not just a partial
   * page short of the full amount). Retries cannot help when the shortfall is
   * caused by a specific corrupted record rather than transient flakiness — see
   * fetchAllPaged, which keeps scanning past a page that never recovers instead
   * of assuming "empty page" means "no more data".
   */
  private fetchPageWithRetry<T extends { id: string }>(
    objectId: string, fieldList: string, mapRow: (r: any) => T, page: number, pageSize: number, attempt = 0
  ): Observable<{ rows: T[]; total: number }> {
    return this.http.get<any>(`/networking/rest/record/${objectId}`, {
      params: { fieldList, page, pageSize, getTotalRecordCount: true, alt: 'json' }
    }).pipe(
      map((response) => ({
        rows: [response?.platform?.record ?? []].flat().map(mapRow),
        total: Number(response?.platform?.totalRecordCount ?? 0)
      })),
      catchError((err) => { console.error(`Fetch ${objectId} (page ${page}, attempt ${attempt}) failed`, err); return of({ rows: [] as T[], total: 0 }); }),
      switchMap((result) => {
        const cameBackShort = result.rows.length < pageSize;
        if (cameBackShort && attempt < AudienceBuilderComponent.MAX_RETRIES_PER_PAGE) {
          return this.fetchPageWithRetry(objectId, fieldList, mapRow, page, pageSize, attempt + 1);
        }
        return of(result);
      })
    );
  }

  /**
   * Walks pages sequentially, retrying short ones, until every row (per totalRecordCount)
   * is collected or the page budget runs out. Deliberately keeps scanning subsequent pages
   * even after one comes back empty post-retry: an empty page can mean either "no more
   * data" or "this page happens to contain a corrupted record ECAP can never serialize" —
   * confirmed live that the latter happens, so stopping early would silently under-report.
   */
  private fetchAllPaged<T extends { id: string }>(
    objectId: string, fieldList: string, mapRow: (r: any) => T, pageSize: number = AudienceBuilderComponent.PAGE_SIZE
  ): Observable<T[]> {
    return new Observable<T[]>((subscriber) => {
      const seen = new Map<string, T>();
      let total = Infinity;

      const nextPage = (page: number) => {
        if (page > AudienceBuilderComponent.MAX_PAGES || seen.size >= total) {
          subscriber.next([...seen.values()]);
          subscriber.complete();
          return;
        }
        this.fetchPageWithRetry(objectId, fieldList, mapRow, page, pageSize).subscribe((result) => {
          if (result.total > 0) total = result.total;
          result.rows.forEach((r) => seen.set(r.id, r));
          nextPage(page + 1);
        });
      };
      nextPage(1);
    });
  }

  /** All descendants (recursive) of a team, via the real self-referencing parent field. */
  descendantsOf(teamId: string): OrgTeam[] {
    const out: OrgTeam[] = [];
    const walk = (id: string) => (this.orgTeamChildren().get(id) ?? []).forEach((c) => { out.push(c); walk(c.id); });
    walk(teamId);
    return out;
  }

  /**
   * ECAP's own hierarchy-expansion rule creates one real, separate Organizational Units row
   * per descendant team (not just a display-time computation) — so once loaded, descendant
   * teams already exist as their own entries in linkedOrgUnits. Rendering them again as
   * top-level rows would double them up; group them under their real linked parent instead.
   */
  readonly topLevelOrgUnits = computed(() => {
    const descendantTeamIds = new Set<string>();
    this.linkedOrgUnits().filter((u) => u.includeTeamHierarchy)
      .forEach((u) => this.descendantsOf(u.teamId).forEach((c) => descendantTeamIds.add(c.id)));
    return this.linkedOrgUnits().filter((u) => !descendantTeamIds.has(u.teamId));
  });

  /** Descendant teams of this row that are actually confirmed present in linkedOrgUnits (real synced state, not a guess). */
  linkedDescendantsOf(teamId: string): OrgTeam[] {
    const linkedTeamIds = new Set(this.linkedOrgUnits().map((u) => u.teamId));
    return this.descendantsOf(teamId).filter((c) => linkedTeamIds.has(c.id));
  }

  /** teamId -> real member count, from the same Teams x Users junction object used for folder-wizard's "My Team" fetch. */
  private readonly teamMemberCounts = signal<Map<string, number>>(new Map());

  memberCountFor(teamId: string): number {
    return this.teamMemberCounts().get(teamId) ?? 0;
  }

  /** Sum of each linked descendant's own direct count — matches "N from sub-teams" in the design. */
  subTeamMemberCount(teamId: string): number {
    return this.linkedDescendantsOf(teamId).reduce((sum, c) => sum + this.memberCountFor(c.id), 0);
  }

  /**
   * Real per-team member count via a filtered, count-only query against the junction object —
   * pageSize 1 since only totalRecordCount is needed, not the rows themselves. Filtering by an
   * exact value (rather than fetching the object unfiltered) is the mitigation already proven
   * reliable for this same object elsewhere in the app.
   */
  private fetchTeamMemberCount(teamId: string): Observable<{ id: string; count: number }> {
    return this.http.get<any>(`/networking/rest/record/${OBJECT_ID.informationManagerTeamsUsers}`, {
      params: {
        filter: `(informationmanagerteams_record equals '${teamId}')`,
        fieldList: 'id', pageSize: 1, getTotalRecordCount: true, alt: 'json'
      }
    }).pipe(
      map((response) => ({ id: teamId, count: Number(response?.platform?.totalRecordCount ?? 0) })),
      catchError((err) => { console.error('Team member count fetch failed', teamId, err); return of({ id: teamId, count: 0 }); })
    );
  }

  /** Fetches counts for every team currently shown (top-level rows + their linked descendants), skipping ones already known. */
  private loadTeamMemberCounts(): void {
    const known = this.teamMemberCounts();
    const ids = new Set<string>();
    this.linkedOrgUnits().forEach((u) => {
      ids.add(u.teamId);
      if (u.includeTeamHierarchy) this.linkedDescendantsOf(u.teamId).forEach((c) => ids.add(c.id));
    });
    const toFetch = [...ids].filter((id) => id && !known.has(id));
    if (!toFetch.length) return;

    forkJoin(toFetch.map((id) => this.fetchTeamMemberCount(id))).subscribe((results) => {
      this.teamMemberCounts.update((map) => {
        const next = new Map(map);
        results.forEach(({ id, count }) => next.set(id, count));
        return next;
      });
    });
  }

  constructor() {
    effect(() => {
      if (this.folderId()) {
        this.loadLinkedOrgUnits();
        this.loadLinkedEmployees();
      }
    });
  }

  /** Real Information Manager Teams, minus ones already linked, filtered by the search box. */
  readonly addableRealTeams = computed(() => {
    const q = this.teamQuery().trim().toLowerCase();
    const linkedIds = new Set(this.linkedOrgUnits().map((u) => u.teamId));
    return this.orgTeams()
      .filter((t) => !linkedIds.has(t.id))
      .filter((t) => !q || t.name.toLowerCase().includes(q));
  });

  /** Real Information Manager Users, minus ones already linked, filtered by the search box. */
  readonly addableRealUsers = computed(() => {
    const q = this.userQuery().trim().toLowerCase();
    const linkedIds = new Set(this.linkedEmployees().map((e) => e.userId));
    return this.orgUsers()
      .filter((u) => !linkedIds.has(u.id))
      .filter((u) => !q || u.label.toLowerCase().includes(q));
  });

  /** Real GET, no subscription — lets applyTemplate/removeTemplate diff a before/after snapshot without a second, slightly different fetch. */
  private fetchLinkedOrgUnits(): Observable<LinkedOrgUnit[]> {
    const folderId = this.folderId();
    if (!folderId) return of([]);
    return this.http.get<any>(`/networking/rest/record/${OBJECT_ID.organizationalUnits}`, {
      params: {
        filter: `(informationfolder_record equals '${folderId}')`,
        fieldList: 'id,informationmanagerteams_record,imt_if_check_box_include_team_hierarchy,date_modified',
        alt: 'json'
      }
    }).pipe(
      map((response): LinkedOrgUnit[] =>
        [response?.platform?.record ?? []].flat().map((r: any) => ({
          recordId: r.id,
          teamId: r.informationmanagerteams_record?.content ?? r.informationmanagerteams_record?.id ?? '',
          teamName: r.informationmanagerteams_record?.displayValue ?? '',
          includeTeamHierarchy: isCheckboxActive(r.imt_if_check_box_include_team_hierarchy),
          lastModifiedTimestamp: r.date_modified ?? ''
        }))),
      catchError((err) => { console.error('Organizational units fetch failed', err); return of([] as LinkedOrgUnit[]); })
    );
  }

  /** GET the real Organizational Units rows already linked to this folder. */
  loadLinkedOrgUnits(): void {
    this.fetchLinkedOrgUnits().subscribe((units) => {
      this.linkedOrgUnits.set(units);
      this.loadTeamMemberCounts();
    });
  }

  /** Creates the real Organizational Units child record — ECAP's own server-side rule then expands the hierarchy and creates acknowledgements. */
  addOrgUnit(teamId: string, teamName: string): void {
    const folderId = this.folderId();
    if (!folderId) return;
    this.orgUnitError.set('');
    const includeTeamHierarchy = this.newUnitIncludeHierarchy();
    const body = {
      informationfolder_record: folderId,
      informationmanagerteams_record: teamId,
      imt_if_check_box_include_team_hierarchy: includeTeamHierarchy ? '1' : '0',
      layout_id: ORGANIZATIONAL_UNIT_LAYOUT_ID,
      _request_id: crypto.randomUUID(),
      _gridSectionsRecords_: {},
      last_modified_timestamp: ''
    };
    this.http.post<any>(`/networking/solution/ServiceDesk/record/${OBJECT_ID.organizationalUnits}`, body, { params: { _uiVersion: 3 } }).subscribe({
      next: () => {
        // Re-fetch rather than optimistically appending: when includeTeamHierarchy is on,
        // ECAP's server-side rule creates one additional Organizational Units row per
        // descendant team — those only become visible by reading them back from ECAP.
        this.loadLinkedOrgUnits();
        this.teamQuery.set('');
        this.newUnitIncludeHierarchy.set(false);
      },
      error: (err) => {
        console.error('Organizational unit create failed', err);
        this.orgUnitError.set(this.lang.isGerman() ? 'Hinzufügen fehlgeschlagen.' : 'Add failed.');
      }
    });
  }

  removeOrgUnit(recordId: string): void {
    this.http.delete(`/networking/solution/ServiceDesk/record/${OBJECT_ID.organizationalUnits}/${recordId}`).subscribe({
      next: () => this.linkedOrgUnits.update((units) => units.filter((u) => u.recordId !== recordId)),
      error: (err) => {
        console.error('Organizational unit delete failed', err);
        this.orgUnitError.set(this.lang.isGerman() ? 'Entfernen fehlgeschlagen.' : 'Remove failed.');
      }
    });
  }

  /** Real GET, no subscription — same reasoning as fetchLinkedOrgUnits above. */
  private fetchLinkedEmployees(): Observable<LinkedEmployee[]> {
    const folderId = this.folderId();
    if (!folderId) return of([]);
    return this.http.get<any>(`/networking/rest/record/${OBJECT_ID.employees}`, {
      params: {
        filter: `(informationfolder_record equals '${folderId}')`,
        fieldList: 'id,informationmanagerusers_record',
        alt: 'json'
      }
    }).pipe(
      map((response): LinkedEmployee[] =>
        [response?.platform?.record ?? []].flat().map((r: any) => ({
          recordId: r.id,
          userId: r.informationmanagerusers_record?.content ?? r.informationmanagerusers_record?.id ?? '',
          userLabel: r.informationmanagerusers_record?.displayValue ?? ''
        }))),
      catchError((err) => { console.error('Employees fetch failed', err); return of([] as LinkedEmployee[]); })
    );
  }

  /** GET the real Employees rows (Folder<->User links) already linked to this folder. */
  loadLinkedEmployees(): void {
    this.fetchLinkedEmployees().subscribe((employees) => this.linkedEmployees.set(employees));
  }

  /** Creates the real Employees child record — ECAP's own server-side rule then creates that user's acknowledgement. */
  addEmployee(userId: string, userLabel: string): void {
    const folderId = this.folderId();
    if (!folderId) return;
    this.employeeError.set('');
    this.http.post<any>(`/networking/solution/ServiceDesk/record/${OBJECT_ID.employees}`, {
      informationfolder_record: folderId,
      informationmanagerusers_record: userId,
      layout_id: EMPLOYEE_LAYOUT_ID,
      _request_id: crypto.randomUUID(),
      _gridSectionsRecords_: {},
      last_modified_timestamp: ''
    }, { params: { _uiVersion: 3 } }).subscribe({
      next: (response) => {
        const recordId = String(response?.record?.id ?? response?.id ?? '');
        this.linkedEmployees.update((employees) => [...employees, { recordId, userId, userLabel }]);
        this.userQuery.set('');
      },
      error: (err) => {
        console.error('Employee create failed', err);
        this.employeeError.set(this.lang.isGerman() ? 'Hinzufügen fehlgeschlagen.' : 'Add failed.');
      }
    });
  }

  removeEmployee(recordId: string): void {
    this.http.delete(`/networking/solution/ServiceDesk/record/${OBJECT_ID.employees}/${recordId}`).subscribe({
      next: () => this.linkedEmployees.update((employees) => employees.filter((e) => e.recordId !== recordId)),
      error: (err) => {
        console.error('Employee delete failed', err);
        this.employeeError.set(this.lang.isGerman() ? 'Entfernen fehlgeschlagen.' : 'Remove failed.');
      }
    });
  }

  /**
   * The real mechanism (confirmed live, via network capture of ECAP's own native
   * "Distribution Template" task button — the DistributionListAttachController.jsp path
   * found earlier turned out to be dead/undeployed code, not what the native UI actually
   * uses): every Information Folder gets its own "Distribution Template" BPM task on
   * creation. Completing that task is what runs DistributionListAttachingHandler
   * server-side. The library's own task-completion payload ({action, note, done}) has no
   * room for form field values, so the sequence is: (1) save the chosen template onto the
   * folder's own information_folder_lu_distribution_list field, (2) find that folder's
   * pending "Distribution Template" task, (3) complete it — completion is what actually
   * triggers the copy, reading whatever is currently saved on the field.
   */
  applyTemplate(templateId: string): void {
    const folderId = this.folderId();
    if (!folderId) return;
    this.templateError.set('');
    this.templateApplying.set(true);

    this.http.get<any>(`/networking/rest/record/${OBJECT_ID.informationFolder}/${folderId}`, {
      params: { fieldList: 'date_modified', alt: 'json' }
    }).pipe(
      switchMap((folderResponse) => {
        const lastModifiedTimestamp = folderResponse?.platform?.record?.date_modified ?? '';
        return this.http.put<any>(
          `/networking/solution/ServiceDesk/record/${OBJECT_ID.informationFolder}/${folderId}`,
          { information_folder_lu_distribution_list: templateId, last_modified_timestamp: lastModifiedTimestamp }
        );
      }),
      switchMap(() =>
        this.http.get<any>('/networking/solution/ServiceDesk/CaseRecordPage', {
          params: { id: folderId, object_id: OBJECT_ID.informationFolder, _component_: 'tasksInfo' }
        })
      ),
      switchMap((tasksResponse) => {
        const pending = [
          ...(tasksResponse?.tasksInfo?.myTasks ?? []),
          ...(tasksResponse?.tasksInfo?.otherTasks ?? [])
        ].find((t: any) => t.subject === 'Distribution Template');
        if (!pending) throw new Error('No pending Distribution Template task found on this folder.');
        return this.http.put<any>(
          `/networking/solution/ServiceDesk/record/tasks/${pending.id}/complete`,
          { action: 'complete', note: '', done: `ServiceDesk/CaseRecordPage?id=${folderId}&object_id=${OBJECT_ID.informationFolder}` }
        );
      })
    ).subscribe({
      next: () => {
        // ECAP itself never tags which org-unit/employee rows a given template created — the
        // only way to know what "undo" should delete is to diff the audience right before vs.
        // right after this apply. That means removeTemplate() only works for the rest of this
        // page's lifetime, not after a reload; acceptable trade-off, confirmed with the user.
        const beforeOrgUnitIds = new Set(this.linkedOrgUnits().map((u) => u.recordId));
        const beforeEmployeeIds = new Set(this.linkedEmployees().map((e) => e.recordId));

        forkJoin({ units: this.fetchLinkedOrgUnits(), employees: this.fetchLinkedEmployees() }).subscribe(({ units, employees }) => {
          this.templateApplying.set(false);
          this.linkedOrgUnits.set(units);
          this.linkedEmployees.set(employees);
          this.loadTeamMemberCounts();

          const newOrgUnitIds = units.map((u) => u.recordId).filter((id) => !beforeOrgUnitIds.has(id));
          const newEmployeeIds = employees.map((e) => e.recordId).filter((id) => !beforeEmployeeIds.has(id));
          this.templateCreatedRecords.update((map) => {
            const next = new Map(map);
            next.set(templateId, { orgUnitRecordIds: newOrgUnitIds, employeeRecordIds: newEmployeeIds });
            return next;
          });
          this.appliedTemplateIds.update((ids) => ids.includes(templateId) ? ids : [...ids, templateId]);
        });
      },
      error: (err) => {
        console.error('Distribution template apply failed', err);
        this.templateApplying.set(false);
        this.templateError.set(err?.message || (this.lang.isGerman() ? 'Anwendung fehlgeschlagen.' : 'Apply failed.'));
      }
    });
  }

  /**
   * Deletes exactly the org-unit/employee rows this specific template's apply created (see the
   * diff captured in applyTemplate) — not every row currently on the folder, so anything added
   * manually before or after applying the template is left alone.
   */
  removeTemplate(templateId: string): void {
    const created = this.templateCreatedRecords().get(templateId);
    if (created) {
      created.orgUnitRecordIds.forEach((id) => this.removeOrgUnit(id));
      created.employeeRecordIds.forEach((id) => this.removeEmployee(id));
      this.templateCreatedRecords.update((map) => {
        const next = new Map(map);
        next.delete(templateId);
        return next;
      });
    }
    this.appliedTemplateIds.update((ids) => ids.filter((id) => id !== templateId));
  }

  save(): void {
    this.continue.emit({ teamCount: this.linkedOrgUnits().length, userCount: this.linkedEmployees().length });
  }
}
