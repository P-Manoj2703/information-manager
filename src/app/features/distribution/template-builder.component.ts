import { Component, effect, inject, input, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { RecordCreateDirective } from '@escriba/cui-ecap-runtime';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { OBJECT_ID } from '@core/objects';

/** Information Manager Teams (2a4456…) — NOT the raw system Team object. */
interface OrgTeam { id: string; name: string; parentId: string; }
/** Information Manager Users (dad2…) — NOT the raw system User. */
interface OrgUser { id: string; label: string; }

interface LinkedTeam {
  recordId: string; teamId: string; teamName: string; includeTeamHierarchy: boolean;
  lastModifiedTimestamp: string;
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
 * two-phase shape already proven for Information Folder and Document Version — and each
 * team/user add below that is an immediate, real create, mirroring AudienceBuilderComponent.
 * Dropped from the mock: the "resolved members with provenance" preview (who's included
 * directly vs. via a team vs. via hierarchy) — ECAP's own Distribution Template screen has no
 * such preview, it just lists the linked teams/users directly.
 */
@Component({
  selector: 'im-template-builder',
  standalone: true,
  imports: [RouterLink, RecordCreateDirective],
  styleUrl: './template-builder.component.scss',
  template: `
    <a class="back" routerLink="/templates">← {{ lang.t('templates') }}</a>

    @if (createPayload()) {
      <ng-container
        [libEcapRuntimeRecordCreate]="createPayload()"
        [objectId]="OBJECT_ID.distributionTemplate"
        (apiResponseEvent)="onCreateResponse($event)"
        (apiErrorEvent)="onCreateError($event)">
      </ng-container>
    }

    <section class="card">
      <header class="head">
        <label class="name-field">
          {{ lang.isGerman() ? 'Name der Vorlage' : 'Template name' }} *
          <input [value]="name()" [disabled]="!!templateId()" (input)="name.set($any($event.target).value)"
                 [placeholder]="lang.isGerman() ? 'z. B. Alle Standorte DACH' : 'e.g. All DACH locations'">
        </label>
        @if (templateId()) {
          <div class="stats" aria-live="polite">
            <div class="stat">
              <span class="eyebrow">{{ lang.isGerman() ? 'Organisationseinheiten' : 'Organisational units' }}</span>
              <strong>{{ linkedTeams().length }}</strong>
            </div>
            <div class="stat">
              <span class="eyebrow">{{ lang.t('users') }}</span>
              <strong>{{ linkedUsers().length }}</strong>
            </div>
          </div>
        }
      </header>

      @if (createError()) { <p class="error">{{ createError() }}</p> }

      @if (!templateId()) {
        <label class="name-field">
          {{ lang.isGerman() ? 'Beschreibung' : 'Description' }}
          <input [value]="description()" (input)="description.set($any($event.target).value)">
        </label>
        <footer>
          <a class="ghost" routerLink="/templates">{{ lang.isGerman() ? 'Abbrechen' : 'Cancel' }}</a>
          <button type="button" class="primary" [disabled]="!name().trim() || creating()" (click)="save()">
            {{ creating() ? (lang.isGerman() ? 'Wird gespeichert…' : 'Saving…') : (lang.isGerman() ? 'Speichern' : 'Save') }}
          </button>
        </footer>
      } @else {
        @if (teamError()) { <p class="error">{{ teamError() }}</p> }
        @if (userError()) { <p class="error">{{ userError() }}</p> }

        <div class="panels">
          <div class="panel">
            <header>
              <span class="panel__title">{{ lang.isGerman() ? 'Organisationseinheiten' : 'Organisational units' }}
                <span class="panel__count">{{ linkedTeams().length }}</span></span>
              <button type="button" class="plus-btn" (click)="showTeamPicker.set(!showTeamPicker())">
                <span class="plus">+</span> {{ lang.isGerman() ? 'Hinzufügen' : 'Add' }}
              </button>
            </header>

            @for (t of topLevelLinkedTeams(); track t.recordId) {
              <div class="row">
                <div class="row__main">
                  <div class="row__name">
                    <strong>{{ t.teamName }}</strong>
                    <small>
                      @if (t.includeTeamHierarchy) {
                        {{ memberCountFor(t.teamId) }} {{ lang.isGerman() ? 'direkt' : 'direct' }}
                        @if (subTeamMemberCount(t.teamId)) {
                          · {{ subTeamMemberCount(t.teamId) }} {{ lang.isGerman() ? 'aus Unterteams' : 'from sub-teams' }}
                        }
                      } @else {
                        {{ memberCountFor(t.teamId) }} {{ lang.isGerman() ? 'Mitglieder' : 'members' }}
                      }
                    </small>
                  </div>
                  <label class="switch" [class.switch--locked]="t.includeTeamHierarchy">
                    <input type="checkbox" class="switch__input" [checked]="t.includeTeamHierarchy"
                           [disabled]="t.includeTeamHierarchy" (change)="enableHierarchy(t)">
                    <span class="switch__track" [class.switch__track--on]="t.includeTeamHierarchy">
                      <span class="switch__thumb"></span>
                    </span>
                    <span class="switch__label">{{ lang.isGerman() ? 'Hierarchie' : 'Hierarchy' }}</span>
                  </label>
                  <button type="button" class="x" (click)="removeTeam(t.recordId)" aria-label="remove">×</button>
                </div>
                @if (t.includeTeamHierarchy && linkedDescendantsOf(t.teamId).length) {
                  <ul class="tree">
                    @for (c of linkedDescendantsOf(t.teamId); track c.id) {
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
                  <input type="checkbox" class="switch__input" [checked]="newTeamIncludeHierarchy()"
                         (change)="newTeamIncludeHierarchy.set(!newTeamIncludeHierarchy())">
                  <span class="switch__track"><span class="switch__thumb"></span></span>
                  <span class="switch__label">{{ lang.isGerman() ? 'Team-Hierarchie einschließen' : 'Include team hierarchy' }}</span>
                </label>
                @if (teamsLoading()) {
                  <span class="lookup__empty">{{ lang.isGerman() ? 'Teams werden geladen…' : 'Loading teams…' }}</span>
                }
                <div class="add">
                  @for (t of addableTeams(); track t.id) {
                    <button type="button" (click)="addTeam(t.id, t.name)">+ {{ t.name }}</button>
                  } @empty {
                    @if (!teamsLoading() && teamQuery().trim()) {
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
                <span class="panel__count">{{ linkedUsers().length }}</span></span>
              <button type="button" class="plus-btn" (click)="showUserPicker.set(!showUserPicker())">
                <span class="plus">+</span> {{ lang.isGerman() ? 'Hinzufügen' : 'Add' }}
              </button>
            </header>

            @if (showUserPicker()) {
              <div class="picker">
                <input type="text" class="lookup__input" [value]="userQuery()"
                       (input)="userQuery.set($any($event.target).value)"
                       [placeholder]="lang.isGerman() ? 'Person suchen…' : 'Search people…'">
                @if (usersLoading()) {
                  <span class="lookup__empty">{{ lang.isGerman() ? 'Personen werden geladen…' : 'Loading people…' }}</span>
                }
                <div class="lookup__results">
                  @for (u of addableUsers(); track u.id) {
                    <button type="button" (click)="addUser(u.id, u.label)">+ {{ u.label }}</button>
                  } @empty {
                    @if (!usersLoading() && userQuery().trim()) {
                      <span class="lookup__empty">{{ lang.isGerman() ? 'Keine Treffer' : 'No matches' }}</span>
                    }
                  }
                </div>
              </div>
            }

            <div class="roster">
              @for (u of linkedUsers(); track u.recordId) {
                <div class="person">
                  <div class="person__id">
                    <span class="person__name">{{ u.userLabel }}</span>
                  </div>
                  <button type="button" class="x" (click)="removeUser(u.recordId)" aria-label="remove">×</button>
                </div>
              }
            </div>
          </div>
        </div>

        <footer>
          <a class="primary" routerLink="/templates">{{ lang.isGerman() ? 'Fertig' : 'Done' }}</a>
        </footer>
      }
    </section>
  `
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
  }

  private loadExistingTemplate(templateId: string): void {
    this.http.get<any>(`/networking/rest/record/${OBJECT_ID.distributionTemplate}/${templateId}`, {
      params: { alt: 'json' }
    }).pipe(
      map((response) => response?.platform?.record),
      catchError((err) => { console.error('Template fetch failed', err); return of(null); })
    ).subscribe((r) => {
      if (!r) return;
      this.name.set(r.distribution_list_tf_distribution_list_name ?? '');
      this.description.set(r.distribution_list_ta_description ?? '');
    });
    this.loadLinkedTeams(templateId);
    this.loadLinkedUsers(templateId);
  }

  save(): void {
    if (!this.name().trim() || this.creating()) return;
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
    this.loadLinkedTeams(newId);
    this.loadLinkedUsers(newId);
  }

  onCreateError(error: any): void {
    this.creating.set(false);
    this.createPayload.set(null);
    this.createError.set(error?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Speichern fehlgeschlagen.' : 'Save failed.'));
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

  /** teamId -> real member count, from the Teams x Users junction object (same source as AudienceBuilderComponent). */
  private readonly teamMemberCounts = signal<Map<string, number>>(new Map());

  memberCountFor(teamId: string): number {
    return this.teamMemberCounts().get(teamId) ?? 0;
  }

  subTeamMemberCount(teamId: string): number {
    return this.linkedDescendantsOf(teamId).reduce((sum, c) => sum + this.memberCountFor(c.id), 0);
  }

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

  private loadTeamMemberCounts(): void {
    const known = this.teamMemberCounts();
    const ids = new Set<string>();
    this.linkedTeams().forEach((t) => {
      ids.add(t.teamId);
      if (t.includeTeamHierarchy) this.linkedDescendantsOf(t.teamId).forEach((c) => ids.add(c.id));
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

  readonly addableTeams = computed(() => {
    const q = this.teamQuery().trim().toLowerCase();
    const linkedIds = new Set(this.linkedTeams().map((t) => t.teamId));
    return this.teams()
      .filter((t) => !linkedIds.has(t.id))
      .filter((t) => !q || t.name.toLowerCase().includes(q));
  });

  readonly addableUsers = computed(() => {
    const q = this.userQuery().trim().toLowerCase();
    const linkedIds = new Set(this.linkedUsers().map((u) => u.userId));
    return this.users()
      .filter((u) => !linkedIds.has(u.id))
      .filter((u) => !q || u.label.toLowerCase().includes(q));
  });

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
        if (cameBackShort && attempt < TemplateBuilderComponent.MAX_RETRIES_PER_PAGE) {
          return this.fetchPageWithRetry(objectId, fieldList, mapRow, page, pageSize, attempt + 1);
        }
        return of(result);
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
        fieldList: 'id,teams_record,distribution_list_teams_cb_include_team_hierarchy,date_modified',
        alt: 'json'
      }
    }).pipe(
      map((response): LinkedTeam[] =>
        [response?.platform?.record ?? []].flat().map((r: any) => ({
          recordId: r.id,
          teamId: r.teams_record?.content ?? r.teams_record?.id ?? '',
          teamName: r.teams_record?.displayValue ?? '',
          includeTeamHierarchy: isCheckboxActive(r.distribution_list_teams_cb_include_team_hierarchy),
          lastModifiedTimestamp: r.date_modified ?? ''
        }))),
      catchError((err) => { console.error('Linked teams fetch failed', err); return of([] as LinkedTeam[]); })
    ).subscribe((teams) => {
      this.linkedTeams.set(teams);
      this.loadTeamMemberCounts();
    });
  }

  /** Same one-way pattern as the folder's own Audience panel: only false → true, never back off. */
  enableHierarchy(team: LinkedTeam): void {
    if (team.includeTeamHierarchy) return;
    this.teamError.set('');
    this.http.patch<any>(`/networking/solution/ServiceDesk/record/${DISTRIBUTION_LIST_TEAMS_OBJECT}/${team.recordId}`, {
      distribution_list_teams_cb_include_team_hierarchy: '1',
      layout_id: DISTRIBUTION_LIST_TEAMS_LAYOUT_ID,
      last_modified_timestamp: team.lastModifiedTimestamp
    }).subscribe({
      next: () => {
        this.linkedTeams.update((teams) =>
          teams.map((t) => t.recordId === team.recordId ? { ...t, includeTeamHierarchy: true } : t));
        this.loadTeamMemberCounts();
      },
      error: (err) => {
        console.error('Template team hierarchy update failed', err);
        this.teamError.set(this.lang.isGerman() ? 'Aktualisierung fehlgeschlagen.' : 'Update failed.');
      }
    });
  }

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
        this.loadLinkedTeams(templateId);
        this.teamQuery.set('');
        this.newTeamIncludeHierarchy.set(false);
      },
      error: (err) => {
        console.error('Add team failed', err);
        this.teamError.set(this.lang.isGerman() ? 'Hinzufügen fehlgeschlagen.' : 'Add failed.');
      }
    });
  }

  removeTeam(recordId: string): void {
    this.http.delete(`/networking/solution/ServiceDesk/record/${DISTRIBUTION_LIST_TEAMS_OBJECT}/${recordId}`).subscribe({
      next: () => this.linkedTeams.update((teams) => teams.filter((t) => t.recordId !== recordId)),
      error: (err) => {
        console.error('Remove team failed', err);
        this.teamError.set(this.lang.isGerman() ? 'Entfernen fehlgeschlagen.' : 'Remove failed.');
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
      next: (response) => {
        const recordId = String(response?.record?.id ?? response?.id ?? '');
        this.linkedUsers.update((users) => [...users, { recordId, userId, userLabel }]);
        this.userQuery.set('');
      },
      error: (err) => {
        console.error('Add user failed', err);
        this.userError.set(this.lang.isGerman() ? 'Hinzufügen fehlgeschlagen.' : 'Add failed.');
      }
    });
  }

  removeUser(recordId: string): void {
    this.http.delete(`/networking/solution/ServiceDesk/record/${DISTRIBUTION_LIST_USERS_OBJECT}/${recordId}`).subscribe({
      next: () => this.linkedUsers.update((users) => users.filter((u) => u.recordId !== recordId)),
      error: (err) => {
        console.error('Remove user failed', err);
        this.userError.set(this.lang.isGerman() ? 'Entfernen fehlgeschlagen.' : 'Remove failed.');
      }
    });
  }
}
