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
      @if (compact()) {
        <div class="summary">
          <header class="summary__head">
            <h2>{{ lang.isGerman() ? 'Zielgruppe' : 'Audience' }}</h2>
            <span class="badge">{{ totalPeople() }} {{ lang.isGerman() ? 'Personen' : 'people' }}</span>
          </header>
          @for (u of topLevelOrgUnits(); track u.recordId) {
            <div class="summary__row">
              <div>
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
              <span class="tag">{{ u.includeTeamHierarchy ? (lang.isGerman() ? 'HIERARCHIE' : 'HIERARCHY') : (lang.isGerman() ? 'ÜBER TEAM' : 'VIA TEAM') }}</span>
            </div>
          }
          @if (linkedEmployees().length) {
            <div class="summary__row">
              <div>
                <strong>{{ linkedEmployees().length }} {{ lang.isGerman() ? 'Einzelpersonen' : 'individual people' }}</strong>
                <small>{{ lang.isGerman() ? 'Manuell hinzugefügt' : 'Added manually' }}</small>
              </div>
              <span class="tag">{{ lang.isGerman() ? 'DIREKT' : 'DIRECT' }}</span>
            </div>
          }
          @if (audienceLoading()) {
            <p class="hint">{{ lang.isGerman() ? 'Wird geladen…' : 'Loading…' }}</p>
          } @else if (!topLevelOrgUnits().length && !linkedEmployees().length) {
            <p class="hint">{{ lang.isGerman() ? 'Noch keine Zielgruppe.' : 'No audience yet.' }}</p>
          }
          <button type="button" class="link-btn" (click)="showFullRoster.emit()">
            {{ lang.isGerman() ? 'Vollständige Liste anzeigen' : 'Show full roster' }}
          </button>
        </div>
      } @else {
      <div class="layout">
        <div class="main">
          <header class="head">
            <div>
              <h2>{{ lang.isGerman() ? 'Zielgruppe' : 'Audience' }}</h2>
              <p>{{ lang.isGerman()
                ? 'Teams, einzelne Personen und Verteilervorlagen an einer Stelle.'
                : 'Teams, individual people and distribution templates in one place.' }}</p>
            </div>
          </header>

          <div class="panels">
            <div class="panel-col">
            <div class="stat" aria-live="polite">
              <span class="eyebrow">{{ lang.isGerman() ? 'Organisationseinheiten' : 'Organisational units' }}</span>
              <strong>{{ linkedOrgUnits().length }}</strong>
            </div>
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
        </div>

        <div class="panel-col">
        <div class="stat" aria-live="polite">
          <span class="eyebrow">{{ lang.t('users') }}</span>
          <strong>{{ linkedEmployees().length }}</strong>
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

      <footer>
        <span class="spacer"></span>
        <button type="button" class="ghost" (click)="back.emit()">{{ lang.isGerman() ? 'Zurück' : 'Back' }}</button>
        <button class="primary" (click)="save()">{{ lang.isGerman() ? 'Weiter' : 'Continue' }}</button>
      </footer>
      }
    </section>
  `
})
export class AudienceBuilderComponent {
  private readonly http = inject(HttpClient);
  readonly lang = inject(LanguageService);

  readonly folderId = input<string>('');
  /** Read-only summary card (folder-detail's default view) instead of the full editor. */
  readonly compact = input(false);
  @Output() readonly continue = new EventEmitter<{ teamCount: number; userCount: number }>();
  /** Navigates back to the Metadata step — this component holds no step-routing logic of its own. */
  @Output() readonly back = new EventEmitter<void>();
  /** Compact mode's "Show full roster" — the parent decides what that means (e.g. switching compact off). */
  @Output() readonly showFullRoster = new EventEmitter<void>();

  readonly totalPeople = computed(() =>
    this.topLevelOrgUnits().reduce((sum, u) =>
      sum + this.memberCountFor(u.teamId) + (u.includeTeamHierarchy ? this.subTeamMemberCount(u.teamId) : 0), 0)
    + this.linkedEmployees().length
  );

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
  private readonly orgUnitsLoaded = signal(false);
  private readonly employeesLoaded = signal(false);
  /** True until both the linked org units and linked employees have loaded at least once — guards the compact card's "no audience yet" message. */
  readonly audienceLoading = computed(() => !this.orgUnitsLoaded() || !this.employeesLoaded());
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

  // Reverted back to 20 (2026-08-15): raising this to 200 broke the Teams/Users pickers
  // entirely (0 results) — this object's own list endpoint apparently can't handle that page
  // size. The 160-team cap this was meant to fix is still real; needs a different fix (e.g. a
  // larger MAX_PAGES at the same pageSize, or a real network capture of why pageSize:200 fails
  // here) before trying again.
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
    objectId: string, fieldList: string, mapRow: (r: any) => T, page: number, pageSize: number, attempt = 0,
    best: { rows: T[]; total: number } | null = null
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
        const total = result.total > 0 ? result.total : (best?.total ?? 0);
        // A later retry flaking and returning fewer rows than an earlier attempt must never
        // discard that earlier, fuller result — keep whichever attempt (so far) has the most rows.
        const better = (!best || result.rows.length > best.rows.length) ? { rows: result.rows, total } : { rows: best.rows, total };
        // Expected row count comes from the real total, not the fixed pageSize — a small,
        // already-complete last page (rows < pageSize) previously looked "short" and triggered
        // pointless retries, one of which could flake and silently lose real rows (see above).
        const expected = total > 0 ? Math.min(pageSize, total - (page - 1) * pageSize) : pageSize;
        const cameBackShort = better.rows.length < expected;
        if (cameBackShort && attempt < AudienceBuilderComponent.MAX_RETRIES_PER_PAGE) {
          return this.fetchPageWithRetry(objectId, fieldList, mapRow, page, pageSize, attempt + 1, better);
        }
        return of(better);
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

  /**
   * teamId -> real member count. ECAP's own Team record already exposes its live member list
   * as a related-list field, InformationManagerTeams_Inform_1 (confirmed via a live network
   * capture of the native Team detail page — CaseRecordPage response's formInfo.relationshipInfo
   * shows it's a real relationship to the Teams x Users junction, and its array length matched
   * the team's true member count exactly). Fetching that per linked team is simpler and
   * reliably correct, replacing an earlier approach that batch-fetched and counted the entire
   * tenant-wide junction object client-side — that turned out to be unreliable (page caps,
   * lookup-field join-key mismatches) for no real benefit over just asking ECAP directly.
   */
  private readonly teamMemberCounts = signal<Map<string, number>>(new Map());
  private readonly memberCountRequested = new Set<string>();

  /** Every team id currently rendered with a count (top-level linked units and their hierarchy-expanded descendants alike — ECAP creates a real row per descendant, so linkedOrgUnits already lists them all). */
  private readonly relevantTeamIds = computed(() => new Set(this.linkedOrgUnits().map((u) => u.teamId).filter(Boolean)));

  /** Reproduces the exact confirmed-working request shape (all three _component_ parts) rather than a slimmer, unverified fieldList guess. */
  private ensureMemberCountFetched(teamId: string): void {
    if (!teamId || this.memberCountRequested.has(teamId)) return;
    this.memberCountRequested.add(teamId);
    this.http.get<any>('/networking/solution/ServiceDesk/CaseRecordPage', {
      params: { object_id: OBJECT_ID.teams, id: teamId, _component_: 'formInfo,record,gridRecords' }
    }).pipe(
      map((r) => Array.isArray(r?.record?.InformationManagerTeams_Inform_1) ? r.record.InformationManagerTeams_Inform_1.length : 0),
      catchError((err) => { console.error(`Member count fetch failed for team ${teamId}`, err); return of(0); })
    ).subscribe((count) => {
      this.teamMemberCounts.update((map) => {
        const next = new Map(map);
        next.set(teamId, count);
        return next;
      });
    });
  }

  memberCountFor(teamId: string): number {
    return this.teamMemberCounts().get(teamId) ?? 0;
  }

  /** Sum of each linked descendant's own direct count — matches "N from sub-teams" in the design. */
  subTeamMemberCount(teamId: string): number {
    return this.linkedDescendantsOf(teamId).reduce((sum, c) => sum + this.memberCountFor(c.id), 0);
  }

  constructor() {
    effect(() => {
      if (this.folderId()) {
        this.loadLinkedOrgUnits();
        this.loadLinkedEmployees();
      }
    });
    effect(() => {
      this.relevantTeamIds().forEach((id) => this.ensureMemberCountFetched(id));
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

  /** Real Information Manager Users, minus ones already linked or currently being added, filtered by the search box. */
  readonly addableRealUsers = computed(() => {
    const q = this.userQuery().trim().toLowerCase();
    const linkedIds = new Set(this.linkedEmployees().map((e) => e.userId));
    const pendingIds = this.addingUserIds();
    return this.orgUsers()
      .filter((u) => !linkedIds.has(u.id) && !pendingIds.has(u.id))
      .filter((u) => !q || u.label.toLowerCase().includes(q));
  });

  /** Real GET, no subscription — lets applyTemplate/removeTemplate diff a before/after snapshot without a second, slightly different fetch. */
  private fetchLinkedOrgUnits(): Observable<LinkedOrgUnit[]> {
    const folderId = this.folderId();
    if (!folderId) return of([]);
    return this.http.get<any>(`/networking/rest/record/${OBJECT_ID.organizationalUnits}`, {
      params: {
        filter: `(informationfolder_record equals '${folderId}')`,
        // last_modified_timestamp deliberately left out — requesting it 400s this object's
        // list query outright (confirmed live, same issue found on Distribution_List_Teams),
        // and it's never actually used for a write here (hierarchy is locked/view-only on
        // this component's own rows).
        fieldList: 'id,informationmanagerteams_record,imt_if_check_box_include_team_hierarchy',
        alt: 'json'
      }
    }).pipe(
      map((response): LinkedOrgUnit[] =>
        [response?.platform?.record ?? []].flat().map((r: any) => ({
          recordId: r.id,
          teamId: r.informationmanagerteams_record?.id ?? r.informationmanagerteams_record?.content ?? '',
          teamName: r.informationmanagerteams_record?.displayValue ?? '',
          includeTeamHierarchy: isCheckboxActive(r.imt_if_check_box_include_team_hierarchy),
          lastModifiedTimestamp: ''
        }))),
      catchError((err) => { console.error('Organizational units fetch failed', err); return of([] as LinkedOrgUnit[]); })
    );
  }

  /** GET the real Organizational Units rows already linked to this folder. */
  loadLinkedOrgUnits(): void {
    this.fetchLinkedOrgUnits().subscribe((units) => {
      this.linkedOrgUnits.set(units);
      this.orgUnitsLoaded.set(true);
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
        // Deliberately NOT reset here — the toggle is a persistent choice for this picker
        // session (e.g. adding several teams in a row, all with hierarchy) until the user
        // themselves flips it again, not a one-shot flag that silently reverts after each add.
      },
      error: (err) => {
        console.error('Organizational unit create failed', err);
        this.orgUnitError.set(err?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Hinzufügen fehlgeschlagen.' : 'Add failed.'));
      }
    });
  }

  removeOrgUnit(recordId: string): void {
    this.http.delete(`/networking/solution/ServiceDesk/record/${OBJECT_ID.organizationalUnits}/${recordId}`).subscribe({
      next: () => this.linkedOrgUnits.update((units) => units.filter((u) => u.recordId !== recordId)),
      error: (err) => {
        console.error('Organizational unit delete failed', err);
        this.orgUnitError.set(err?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Entfernen fehlgeschlagen.' : 'Remove failed.'));
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
    this.fetchLinkedEmployees().subscribe((employees) => {
      this.linkedEmployees.set(employees);
      this.employeesLoaded.set(true);
    });
  }

  /** Users currently mid-add (POST in flight) — kept out of addableRealUsers() so a second click before the server responds can't fire a duplicate create. */
  private readonly addingUserIds = signal<Set<string>>(new Set());

  /** Creates the real Employees child record — ECAP's own server-side rule then creates that user's acknowledgement. */
  addEmployee(userId: string, userLabel: string): void {
    const folderId = this.folderId();
    if (!folderId || this.addingUserIds().has(userId)) return;
    this.employeeError.set('');
    this.addingUserIds.update((ids) => new Set(ids).add(userId));
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
        this.addingUserIds.update((ids) => { const next = new Set(ids); next.delete(userId); return next; });
      },
      error: (err) => {
        console.error('Employee create failed', err);
        this.employeeError.set(err?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Hinzufügen fehlgeschlagen.' : 'Add failed.'));
        this.addingUserIds.update((ids) => { const next = new Set(ids); next.delete(userId); return next; });
      }
    });
  }

  removeEmployee(recordId: string): void {
    this.http.delete(`/networking/solution/ServiceDesk/record/${OBJECT_ID.employees}/${recordId}`).subscribe({
      next: () => this.linkedEmployees.update((employees) => employees.filter((e) => e.recordId !== recordId)),
      error: (err) => {
        console.error('Employee delete failed', err);
        this.employeeError.set(err?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Entfernen fehlgeschlagen.' : 'Remove failed.'));
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
    // templateApplying guards against a second click (same or different template) firing this
    // multi-step chain again before the first one finishes — a race that previously produced a
    // real 500 from ECAP (the first apply's task/record state no longer matches what the second,
    // concurrent chain expects to find).
    if (!folderId || this.templateApplying()) return;
    this.templateError.set('');
    this.templateApplying.set(true);

    this.http.get<any>(`/networking/rest/record/${OBJECT_ID.informationFolder}/${folderId}`, {
      params: { fieldList: 'last_modified_timestamp', alt: 'json' }
    }).pipe(
      switchMap((folderResponse) => {
        const lastModifiedTimestamp = folderResponse?.platform?.record?.last_modified_timestamp ?? '';
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
