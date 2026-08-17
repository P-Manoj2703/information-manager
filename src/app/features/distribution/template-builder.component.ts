import { Component, effect, inject, input, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { RecordCreateDirective } from '@escriba/cui-ecap-runtime';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { OBJECT_ID } from '@core/objects';

/** Information Manager Teams (2a4456…) — NOT the raw system Team object. */
interface OrgTeam { id: string; name: string; parentId: string; }
/** Information Manager Users (dad2…) — NOT the raw system User. */
interface OrgUser { id: string; label: string; }

interface LinkedTeam {
  recordId: string; teamId: string; teamName: string; includeTeamHierarchy: boolean;
}
interface LinkedUser { recordId: string; userId: string; userLabel: string; }

/** Distribution_List_Teams / Distribution_List_Users checkboxes round-trip as "1"/"0" — same convention confirmed on Organizational_Units. */
function isCheckboxActive(val: unknown): boolean {
  if (val == null) return false;
  const s = String(val);
  return s === '1' || s.toLowerCase() === 'true' || s.toLowerCase() === 'yes';
}

const DISTRIBUTION_LIST_TEAMS_OBJECT = '4c8a796eb68640e790ceda13abb8e9e1';
const DISTRIBUTION_LIST_TEAMS_LAYOUT_ID = 'a1d457b30aa546319d7dd85ab73bbf58';
const DISTRIBUTION_LIST_USERS_OBJECT = 'e180bc457fc9435ab8f993f475ad0a9c';
const DISTRIBUTION_LIST_USERS_LAYOUT_ID = 'd76f20eed59d49ba8a7039506dd799d6';
const DISTRIBUTION_LIST_LAYOUT_ID = 'cb599bfbc9dd4071b81f31afd10663ca';

/**
 * UC-ADM-03. Create or edit a distribution template — a standalone bundle of teams and
 * people that folders can apply later (see AudienceBuilderComponent's template picker).
 *
 * Real object model, confirmed live against ECAP (2026-08-09):
 *  - Distribution_Lists (45aed8d7…) — the template itself: name + description.
 *  - Distribution_List_Teams (4c8a796e…) — one row per linked org unit: distributionlist_record,
 *    teams_record (→ Information Manager Teams), distribution_list_teams_cb_include_team_hierarchy.
 *  - Distribution_List_Users (e180bc45…) — one row per linked person: distributionlist_record,
 *    users_record (→ Information Manager Users).
 *
 * The template record has to exist before either junction object can reference it, so unlike
 * the original mock (single "Save" at the end), this saves the name/description first — same
 * two-phase shape already proven for Information Folder and Document Version.
 *
 * Picking a team/user from the "+ Add" picker creates the real Distribution_List_Teams/Users
 * row immediately — same immediate-persist convention as Information Folder's own Audience
 * panel (AudienceBuilderComponent), not a stage-then-save step. Removing a row is equally
 * immediate. Dropped from the mock: the "resolved members with provenance" preview (who's
 * included directly vs. via a team vs. via hierarchy) — ECAP's own Distribution Template screen
 * has no such preview, it just lists the linked teams/users directly.
 */
@Component({
  selector: 'im-template-builder',
  standalone: true,
  imports: [RouterLink, RecordCreateDirective],
  templateUrl: './template-builder.component.html',
  styleUrl: './template-builder.component.scss'
})
export class TemplateBuilderComponent {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  readonly lang = inject(LanguageService);
  readonly OBJECT_ID = OBJECT_ID;

  readonly id = input<string>('');

  readonly name = signal('');
  readonly description = signal('');
  readonly templateId = signal<string | null>(null);
  /** True while the user is (re-)editing Name/Description for an already-created template, reached via the Back button. */
  readonly editingMeta = signal(false);
  /** Last known-saved values — restores name()/description() on Cancel instead of leaving whatever was mid-typed. */
  private readonly savedName = signal('');
  private readonly savedDescription = signal('');

  readonly creating = signal(false);
  readonly createError = signal('');
  readonly createPayload = signal<Record<string, unknown> | null>(null);

  private loadedExistingId: string | null = null;

  constructor() {
    // effect(), not a constructor-body read: route-bound inputs are set via setInput() after
    // construction, so reading this.id() directly here would always see its default ''.
    effect(() => {
      const id = this.id();
      if (!id || this.loadedExistingId === id) return;
      this.loadedExistingId = id;
      this.templateId.set(id);
      this.loadExistingTemplate(id);
    }, { allowSignalWrites: true });
    effect(() => {
      this.relevantTeamIds().forEach((id) => this.ensureMemberCountFetched(id));
    });
  }

  private loadExistingTemplate(templateId: string): void {
    this.http.get<any>(`/networking/rest/record/${OBJECT_ID.distributionTemplate}/${templateId}`, {
      params: { alt: 'json' }
    }).pipe(
      map((response) => response?.platform?.record),
      catchError((err) => { console.error('Template fetch failed', err); return of(null); })
    ).subscribe((r) => {
      if (!r) return;
      const name = r.distribution_list_tf_distribution_list_name ?? '';
      const description = r.distribution_list_ta_description ?? '';
      this.name.set(name);
      this.description.set(description);
      this.savedName.set(name);
      this.savedDescription.set(description);
    });
    this.loadLinkedTeams(templateId);
    this.loadLinkedUsers(templateId);
  }

  /** Reached from the Organisational Units/Users screen — re-enables the Name/Description form without touching already-linked teams/users. */
  backToEditMeta(): void {
    this.createError.set('');
    this.editingMeta.set(true);
  }

  /** Discards unsaved edits and returns to the Organisational Units/Users screen — the record itself is untouched. */
  cancelEditMeta(): void {
    this.name.set(this.savedName());
    this.description.set(this.savedDescription());
    this.createError.set('');
    this.editingMeta.set(false);
  }

  save(): void {
    if (!this.name().trim() || this.creating()) return;
    const templateId = this.templateId();
    if (templateId) { this.updateMeta(templateId); return; }
    this.creating.set(true);
    this.createError.set('');
    this.createPayload.set({
      distribution_list_tf_distribution_list_name: this.name().trim(),
      distribution_list_ta_description: this.description().trim(),
      layout_id: DISTRIBUTION_LIST_LAYOUT_ID,
      _request_id: crypto.randomUUID(),
      _gridSectionsRecords_: {},
      last_modified_timestamp: ''
    });
  }

  onCreateResponse(response: any): void {
    this.creating.set(false);
    this.createPayload.set(null);
    const newId = String(response?.record?.id ?? response?.id ?? '');
    this.templateId.set(newId);
    this.savedName.set(this.name().trim());
    this.savedDescription.set(this.description().trim());
    this.loadLinkedTeams(newId);
    this.loadLinkedUsers(newId);
  }

  onCreateError(error: any): void {
    this.creating.set(false);
    this.createPayload.set(null);
    this.createError.set(error?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Speichern fehlgeschlagen.' : 'Save failed.'));
  }

  /**
   * Real update of the already-created template — PUT, not PATCH: PATCH is silently accepted
   * (200/success body) but never actually persists on this tenant, same issue confirmed on
   * Information Folder's own update. Fetches the record's current last_modified_timestamp
   * (ECAP's optimistic-concurrency token) first, same two-step pattern used there too.
   */
  private updateMeta(templateId: string): void {
    this.creating.set(true);
    this.createError.set('');
    this.http.get<any>(`/networking/rest/record/${OBJECT_ID.distributionTemplate}/${templateId}`, {
      params: { fieldList: 'last_modified_timestamp', alt: 'json' }
    }).pipe(
      switchMap((response) => {
        const lastModifiedTimestamp = response?.platform?.record?.last_modified_timestamp ?? '';
        return this.http.put<any>(`/networking/solution/ServiceDesk/record/${OBJECT_ID.distributionTemplate}/${templateId}`, {
          distribution_list_tf_distribution_list_name: this.name().trim(),
          distribution_list_ta_description: this.description().trim(),
          layout_id: DISTRIBUTION_LIST_LAYOUT_ID,
          last_modified_timestamp: lastModifiedTimestamp
        });
      })
    ).subscribe({
      next: () => {
        this.creating.set(false);
        this.savedName.set(this.name().trim());
        this.savedDescription.set(this.description().trim());
        this.editingMeta.set(false);
      },
      error: (err) => {
        console.error('Update template failed', err);
        this.creating.set(false);
        this.createError.set(err?.error?.platform?.message?.description ?? err?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Speichern fehlgeschlagen.' : 'Save failed.'));
      }
    });
  }

  readonly teamQuery = signal('');
  readonly userQuery = signal('');
  readonly showTeamPicker = signal(false);
  readonly showUserPicker = signal(false);
  readonly newTeamIncludeHierarchy = signal(false);

  readonly linkedTeams = signal<LinkedTeam[]>([]);
  readonly linkedUsers = signal<LinkedUser[]>([]);
  readonly teamError = signal('');
  readonly userError = signal('');
  readonly teamsLoading = signal(true);
  readonly usersLoading = signal(true);

  // Reverted back to 20 (2026-08-15): raising this to 200 broke the Teams/Users pickers
  // entirely (0 results) — this object's own list endpoint apparently can't handle that page
  // size. The 160-team cap this was meant to fix is still real; needs a different fix (e.g. a
  // larger MAX_PAGES at the same pageSize, or a real network capture of why pageSize:200 fails
  // here) before trying again.
  private static readonly PAGE_SIZE = 20;
  private static readonly MAX_PAGES = 8;
  private static readonly MAX_RETRIES_PER_PAGE = 5;

  /** Same real Information Manager Teams fetch as AudienceBuilderComponent — same known list-endpoint unreliability, same retry-hardened approach. */
  private readonly teams = toSignal(
    this.fetchAllPaged<OrgTeam>(
      OBJECT_ID.teams,
      'id,name,information_manager_teams_lookup_self_referencing',
      (r): OrgTeam => ({ id: r.id, name: r.name, parentId: r.information_manager_teams_lookup_self_referencing?.content ?? '' })
    ).pipe(map((teams) => { this.teamsLoading.set(false); return teams; })),
    { initialValue: [] as OrgTeam[] }
  );

  private readonly users = toSignal(
    this.fetchAllPaged<OrgUser>(
      OBJECT_ID.users,
      'id,information_manager_user_text_field_first_name,information_manager_user_text_field_last_name,information_manager_user_email_address_email',
      (r): OrgUser => {
        const first = r.information_manager_user_text_field_first_name ?? '';
        const last = r.information_manager_user_text_field_last_name ?? '';
        const email = r.information_manager_user_email_address_email ?? '';
        const fullName = `${first} ${last}`.trim();
        return { id: r.id, label: fullName ? `${fullName} (${email})` : email };
      }
    ).pipe(map((users) => { this.usersLoading.set(false); return users; })),
    { initialValue: [] as OrgUser[] }
  );

  /** id -> direct children, from information_manager_teams_lookup_self_referencing (real parent pointer within this same object). */
  private readonly orgTeamChildren = computed(() => {
    const byParent = new Map<string, OrgTeam[]>();
    this.teams().forEach((t) => {
      if (!t.parentId || t.parentId === t.id) return;
      byParent.set(t.parentId, [...(byParent.get(t.parentId) ?? []), t]);
    });
    return byParent;
  });

  /** All descendants (recursive) of a team, via the real self-referencing parent field. */
  descendantsOf(teamId: string): OrgTeam[] {
    const out: OrgTeam[] = [];
    const walk = (id: string) => (this.orgTeamChildren().get(id) ?? []).forEach((c) => { out.push(c); walk(c.id); });
    walk(teamId);
    return out;
  }

  /**
   * ECAP's own hierarchy-expansion rule creates one real, separate Distribution_List_Teams row
   * per descendant team — group them under their real linked parent instead of listing them
   * again as top-level rows (same approach as AudienceBuilderComponent).
   */
  readonly topLevelLinkedTeams = computed(() => {
    const descendantTeamIds = new Set<string>();
    this.linkedTeams().filter((t) => t.includeTeamHierarchy)
      .forEach((t) => this.descendantsOf(t.teamId).forEach((c) => descendantTeamIds.add(c.id)));
    return this.linkedTeams().filter((t) => !descendantTeamIds.has(t.teamId));
  });

  /** Descendant teams of this row that are actually confirmed present in linkedTeams (real synced state, not a guess). */
  linkedDescendantsOf(teamId: string): OrgTeam[] {
    const linkedTeamIds = new Set(this.linkedTeams().map((t) => t.teamId));
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

  /** Every team id currently rendered with a count (top-level linked teams and their hierarchy-expanded descendants alike — ECAP creates a real row per descendant, so linkedTeams already lists them all). */
  private readonly relevantTeamIds = computed(() => new Set(this.linkedTeams().map((t) => t.teamId).filter(Boolean)));

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

  subTeamMemberCount(teamId: string): number {
    return this.linkedDescendantsOf(teamId).reduce((sum, c) => sum + this.memberCountFor(c.id), 0);
  }

  readonly addableTeams = computed(() => {
    const q = this.teamQuery().trim().toLowerCase();
    const excludedIds = new Set(this.linkedTeams().map((t) => t.teamId));
    return this.teams()
      .filter((t) => !excludedIds.has(t.id))
      .filter((t) => !q || t.name.toLowerCase().includes(q));
  });

  readonly addableUsers = computed(() => {
    const q = this.userQuery().trim().toLowerCase();
    const excludedIds = new Set(this.linkedUsers().map((u) => u.userId));
    return this.users()
      .filter((u) => !excludedIds.has(u.id))
      .filter((u) => !q || u.label.toLowerCase().includes(q));
  });

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
        if (cameBackShort && attempt < TemplateBuilderComponent.MAX_RETRIES_PER_PAGE) {
          return this.fetchPageWithRetry(objectId, fieldList, mapRow, page, pageSize, attempt + 1, better);
        }
        return of(better);
      })
    );
  }

  private fetchAllPaged<T extends { id: string }>(
    objectId: string, fieldList: string, mapRow: (r: any) => T, pageSize: number = TemplateBuilderComponent.PAGE_SIZE
  ): Observable<T[]> {
    return new Observable<T[]>((subscriber) => {
      const seen = new Map<string, T>();
      let total = Infinity;

      const nextPage = (page: number) => {
        if (page > TemplateBuilderComponent.MAX_PAGES || seen.size >= total) {
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

  private loadLinkedTeams(templateId: string): void {
    this.http.get<any>(`/networking/rest/record/${DISTRIBUTION_LIST_TEAMS_OBJECT}`, {
      params: {
        filter: `(distributionlist_record equals '${templateId}')`,
        // last_modified_timestamp deliberately left out — requesting it here 400s this
        // particular object's list query outright (confirmed live), unlike Information Folder
        // where it's a normal field. Hierarchy itself is locked once saved — see the row's own
        // switch in the template — so this value is never written back after being read here.
        fieldList: 'id,teams_record,distribution_list_teams_cb_include_team_hierarchy',
        alt: 'json'
      }
    }).pipe(
      map((response): LinkedTeam[] =>
        [response?.platform?.record ?? []].flat().map((r: any) => ({
          recordId: r.id,
          teamId: r.teams_record?.id ?? r.teams_record?.content ?? '',
          teamName: r.teams_record?.displayValue ?? '',
          includeTeamHierarchy: isCheckboxActive(r.distribution_list_teams_cb_include_team_hierarchy)
        }))),
      catchError((err) => { console.error('Linked teams fetch failed', err); return of([] as LinkedTeam[]); })
    ).subscribe((teams) => this.linkedTeams.set(teams));
  }

  /** Creates the real Distribution_List_Teams row immediately — same immediate-persist pattern as AudienceBuilderComponent's addOrgUnit. */
  addTeam(teamId: string, teamName: string): void {
    const templateId = this.templateId();
    if (!templateId) return;
    this.teamError.set('');
    const includeTeamHierarchy = this.newTeamIncludeHierarchy();
    this.http.post<any>(`/networking/solution/ServiceDesk/record/${DISTRIBUTION_LIST_TEAMS_OBJECT}`, {
      distributionlist_record: templateId,
      teams_record: teamId,
      distribution_list_teams_cb_include_team_hierarchy: includeTeamHierarchy ? '1' : '0',
      layout_id: DISTRIBUTION_LIST_TEAMS_LAYOUT_ID,
      _request_id: crypto.randomUUID(),
      _gridSectionsRecords_: {},
      last_modified_timestamp: ''
    }, { params: { _uiVersion: 3 } }).subscribe({
      next: () => {
        // Re-fetch rather than optimistically appending: when includeTeamHierarchy is on,
        // ECAP's server-side rule creates one additional row per descendant team — those
        // only become visible by reading them back from ECAP.
        this.loadLinkedTeams(templateId);
        this.teamQuery.set('');
        // Deliberately NOT reset here — the toggle is a persistent choice for this picker
        // session (e.g. adding several teams in a row, all with hierarchy) until the user
        // themselves flips it again, not a one-shot flag that silently reverts after each add.
      },
      error: (err) => {
        console.error('Add team failed', teamName, err);
        this.teamError.set(err?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Hinzufügen fehlgeschlagen.' : 'Add failed.'));
      }
    });
  }

  removeTeam(recordId: string): void {
    this.http.delete(`/networking/solution/ServiceDesk/record/${DISTRIBUTION_LIST_TEAMS_OBJECT}/${recordId}`).subscribe({
      next: () => this.linkedTeams.update((teams) => teams.filter((t) => t.recordId !== recordId)),
      error: (err) => {
        console.error('Remove team failed', err);
        this.teamError.set(err?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Entfernen fehlgeschlagen.' : 'Remove failed.'));
      }
    });
  }

  private loadLinkedUsers(templateId: string): void {
    this.http.get<any>(`/networking/rest/record/${DISTRIBUTION_LIST_USERS_OBJECT}`, {
      params: {
        filter: `(distributionlist_record equals '${templateId}')`,
        fieldList: 'id,users_record',
        alt: 'json'
      }
    }).pipe(
      map((response): LinkedUser[] =>
        [response?.platform?.record ?? []].flat().map((r: any) => ({
          recordId: r.id,
          userId: r.users_record?.content ?? r.users_record?.id ?? '',
          userLabel: r.users_record?.displayValue ?? ''
        }))),
      catchError((err) => { console.error('Linked users fetch failed', err); return of([] as LinkedUser[]); })
    ).subscribe((users) => this.linkedUsers.set(users));
  }

  /** Creates the real Distribution_List_Users row immediately — same immediate-persist pattern as AudienceBuilderComponent's addEmployee. */
  addUser(userId: string, userLabel: string): void {
    const templateId = this.templateId();
    if (!templateId) return;
    this.userError.set('');
    this.http.post<any>(`/networking/solution/ServiceDesk/record/${DISTRIBUTION_LIST_USERS_OBJECT}`, {
      distributionlist_record: templateId,
      users_record: userId,
      layout_id: DISTRIBUTION_LIST_USERS_LAYOUT_ID,
      _request_id: crypto.randomUUID(),
      _gridSectionsRecords_: {},
      last_modified_timestamp: ''
    }, { params: { _uiVersion: 3 } }).subscribe({
      next: () => {
        this.loadLinkedUsers(templateId);
        this.userQuery.set('');
      },
      error: (err) => {
        console.error('Add user failed', userLabel, err);
        this.userError.set(err?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Hinzufügen fehlgeschlagen.' : 'Add failed.'));
      }
    });
  }

  removeUser(recordId: string): void {
    this.http.delete(`/networking/solution/ServiceDesk/record/${DISTRIBUTION_LIST_USERS_OBJECT}/${recordId}`).subscribe({
      next: () => this.linkedUsers.update((users) => users.filter((u) => u.recordId !== recordId)),
      error: (err) => {
        console.error('Remove user failed', err);
        this.userError.set(err?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Entfernen fehlgeschlagen.' : 'Remove failed.'));
      }
    });
  }
}
