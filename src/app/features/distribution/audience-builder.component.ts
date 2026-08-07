import { Component, EventEmitter, Output, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AppUser, DistributionTemplate, Team } from '@core/models';
import { DataPort } from '@core/services/data.port';
import { AudienceService } from '@core/services/audience.service';
import { DistributionService } from '@core/services/distribution.service';
import { LanguageService } from '@core/i18n/language.service';
import { SERVER_MESSAGE } from '@core/server-messages';
import { ProvenancePillComponent } from '@shared/ui/provenance-pill.component';
import { TemplatePickerComponent } from './template-picker.component';

interface LinkedTeam {
  teamId: string;
  includeTeamHierarchy: boolean;
  locked: boolean;
  /** Sub-teams individually removed from this row's hierarchy expansion. */
  excludedChildIds: string[];
}

/**
 * UC-IP-02 / UC-ADM-03. One panel for the three mechanisms the platform keeps
 * apart (teams subform, users subform, template lookup). The live count is the
 * single highest-value element here.
 *
 * "Include sub-teams" is a one-way switch: once it is on and the step is saved,
 * it locks — matches the platform rule that a widened audience can't silently
 * shrink again by re-toggling.
 */
@Component({
  selector: 'im-audience-builder',
  standalone: true,
  imports: [ProvenancePillComponent, TemplatePickerComponent],
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
                <strong>{{ linked().length }}</strong>
              </div>
              <div class="stat">
                <span class="eyebrow">{{ lang.t('users') }}</span>
                <strong>{{ members().length }}</strong>
              </div>
            </div>
          </header>

          @if (duplicateError()) { <p class="error">{{ duplicateError() }}</p> }

          <div class="panels">
            <div class="panel">
          <header>
            <span class="panel__title">{{ lang.isGerman() ? 'Organisationseinheiten' : 'Organisational units' }}
              <span class="panel__count">{{ linked().length }}</span></span>
            <button type="button" class="plus-btn" (click)="showTeamPicker.set(!showTeamPicker())">
              <span class="plus">+</span> {{ lang.isGerman() ? 'Hinzufügen' : 'Add' }}
            </button>
          </header>

          @for (l of linked(); track l.teamId) {
            <div class="row">
              <div class="row__main">
                <div class="row__name">
                  <strong>{{ teamName(l.teamId) }}</strong>
                  <small>
                    {{ rowCounts(l).direct }} {{ lang.isGerman() ? 'direkt' : 'direct' }}
                    @if (l.includeTeamHierarchy && rowCounts(l).fromSubTeams) {
                      · {{ rowCounts(l).fromSubTeams }} {{ lang.isGerman() ? 'aus Unterteams' : 'from sub-teams' }}
                    }
                  </small>
                </div>
                @if (l.locked) {
                  <span class="switch switch--locked" [title]="lang.isGerman()
                      ? 'Unterteams eingeschlossen — gespeichert, kann nicht mehr deaktiviert werden'
                      : 'Sub-teams included — saved, can no longer be turned off'">
                    <span class="switch__track switch__track--on"><span class="switch__thumb"></span></span>
                    <span class="switch__label">🔒 {{ lang.isGerman() ? 'inkl. Unterteams' : 'incl. sub-teams' }}</span>
                  </span>
                } @else {
                  <label class="switch">
                    <input type="checkbox" class="switch__input" [checked]="l.includeTeamHierarchy" (change)="toggleHierarchy(l.teamId)">
                    <span class="switch__track"><span class="switch__thumb"></span></span>
                    <span class="switch__label">{{ lang.isGerman() ? 'inkl. Unterteams' : 'incl. sub-teams' }}</span>
                  </label>
                }
                <button type="button" class="x" (click)="unlink(l.teamId)" aria-label="remove">×</button>
              </div>

              @if (l.includeTeamHierarchy && visibleChildTeams(l).length) {
                <ul class="tree">
                  @for (c of visibleChildTeams(l); track c.id) {
                    <li>
                      <span>{{ c.information_manager_teams_textfield_name }}</span>
                      <span class="tree__right">
                        <span class="tree__count">{{ lang.isGerman() ? 'automatisch verknüpft' : 'auto-linked' }} · {{ c.memberCount }}</span>
                        @if (!l.locked) {
                          <button type="button" class="x" (click)="excludeChild(l.teamId, c.id)" aria-label="remove">×</button>
                        }
                      </span>
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
              <div class="add">
                @for (t of addableTeams(); track t.id) {
                  <button type="button" (click)="link(t.id)">+ {{ t.information_manager_teams_textfield_name }}</button>
                } @empty {
                  @if (teamQuery().trim()) {
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
              <span class="panel__count">{{ members().length }}</span></span>
            <button type="button" class="plus-btn" (click)="showUserPicker.set(!showUserPicker())">
              <span class="plus">+</span> {{ lang.isGerman() ? 'Hinzufügen' : 'Add' }}
            </button>
          </header>

          @if (showUserPicker()) {
            <div class="picker">
              <input type="text" class="lookup__input" [value]="userQuery()"
                     (input)="userQuery.set($any($event.target).value)"
                     [placeholder]="lang.isGerman() ? 'Person suchen…' : 'Search people…'">
              @if (userQuery().trim()) {
                <div class="lookup__results">
                  @for (u of addableUsers(); track u.id) {
                    <button type="button" (click)="addUser(u.id)">
                      + {{ u.firstName }} {{ u.lastName }} <small>{{ teamName(u.primaryTeamId) }}</small>
                    </button>
                  } @empty {
                    <span class="lookup__empty">{{ lang.isGerman() ? 'Keine Treffer' : 'No matches' }}</span>
                  }
                </div>
              }
            </div>
          }

          <div class="roster">
            @for (m of members(); track m.user.id) {
              <div class="person">
                <div class="person__id">
                  <span class="person__name">{{ m.user.firstName }} {{ m.user.lastName }}</span>
                  <span class="person__team">{{ teamName(m.user.primaryTeamId) }}</span>
                </div>
                <im-provenance-pill [kind]="m.provenance" />
                @if (m.provenance === 'direct') {
                  <button type="button" class="x" (click)="removeUser(m.user.id)" aria-label="remove">×</button>
                }
              </div>
            }
          </div>
          </div>
        </div>
        </div>

        <aside class="sidebar">
          <im-template-picker [templates]="templates()" [appliedIds]="appliedTemplateIds()"
                               (apply)="applyTemplate($event)" />
        </aside>
      </div>

      <footer><button class="primary" (click)="save()">{{ lang.isGerman() ? 'Weiter' : 'Continue' }}</button></footer>
    </section>
  `
})
export class AudienceBuilderComponent {
  private readonly data = inject(DataPort);
  private readonly audience = inject(AudienceService);
  private readonly distribution = inject(DistributionService);
  readonly lang = inject(LanguageService);

  readonly folderId = input<string>('');
  @Output() readonly continue = new EventEmitter<{ teamCount: number; userCount: number }>();

  readonly linked = signal<LinkedTeam[]>([]);
  readonly directUserIds = signal<string[]>([]);
  readonly duplicateError = signal<string | null>(null);
  readonly teamQuery = signal('');
  readonly userQuery = signal('');
  readonly appliedTemplateIds = signal<string[]>([]);
  readonly showTeamPicker = signal(false);
  readonly showUserPicker = signal(false);

  private readonly teams = toSignal(this.data.teams(), { initialValue: [] as Team[] });
  private readonly users = toSignal(this.data.users(), { initialValue: [] as AppUser[] });
  readonly templates = toSignal(this.data.templates(), { initialValue: [] as DistributionTemplate[] });

  /** Deduplicated, provenance-ranked. Same algorithm as AudienceService.resolve. */
  readonly members = computed(() => {
    const rank = { direct: 3, team: 2, hierarchy: 1 } as const;
    const out = new Map<string, { user: AppUser; provenance: 'direct' | 'team' | 'hierarchy' }>();
    const add = (u: AppUser | undefined, p: 'direct' | 'team' | 'hierarchy') => {
      if (!u?.active) return;
      const prev = out.get(u.id);
      if (prev && rank[prev.provenance] >= rank[p]) return;
      out.set(u.id, { user: u, provenance: p });
    };
    this.directUserIds().forEach((id) => add(this.users().find((u) => u.id === id), 'direct'));
    this.linked().forEach((l) => {
      this.users().filter((u) => u.primaryTeamId === l.teamId).forEach((u) => add(u, 'team'));
      if (l.includeTeamHierarchy) {
        this.visibleChildTeams(l).forEach((child) =>
          this.users().filter((u) => u.primaryTeamId === child.id).forEach((u) => add(u, 'hierarchy')));
      }
    });
    return [...out.values()];
  });

  readonly addableTeams = computed(() => {
    const q = this.teamQuery().trim().toLowerCase();
    return this.teams()
      .filter((t) => !this.linked().some((l) => l.teamId === t.id))
      .filter((t) => !q || t.information_manager_teams_textfield_name.toLowerCase().includes(q));
  });

  /** Searchable users lookup, kept separate from the teams lookup above. Only searches, doesn't dump the whole directory. */
  readonly addableUsers = computed(() => {
    const q = this.userQuery().trim().toLowerCase();
    if (!q) return [];
    const already = new Set(this.members().map((m) => m.user.id));
    return this.users()
      .filter((u) => u.active && !already.has(u.id))
      .filter((u) => `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      .slice(0, 8);
  });

  teamName = (id: string) =>
    this.teams().find((t) => t.id === id)?.information_manager_teams_textfield_name ?? id;

  private teamMemberCount = (id: string) => this.teams().find((t) => t.id === id)?.memberCount ?? 0;

  /** Direct members of the row's team, plus members pulled in from sub-teams once hierarchy is on. */
  rowCounts(l: LinkedTeam): { direct: number; fromSubTeams: number } {
    const direct = this.teamMemberCount(l.teamId);
    const fromSubTeams = l.includeTeamHierarchy
      ? this.visibleChildTeams(l).reduce((sum, c) => sum + c.memberCount, 0)
      : 0;
    return { direct, fromSubTeams };
  }

  /** All descendants minus whatever this row has individually excluded. */
  visibleChildTeams = (l: LinkedTeam): Team[] =>
    this.audience.descendants(this.teams(), l.teamId).filter((c) => !l.excludedChildIds.includes(c.id));

  /** One-way like the hierarchy toggle itself: only available before the row is saved/locked. */
  excludeChild(teamId: string, childId: string): void {
    this.linked.update((l) => l.map((x) =>
      x.teamId === teamId ? { ...x, excludedChildIds: [...x.excludedChildIds, childId] } : x));
  }

  /** validateAndExpandTeamHierarchyOnLink — reject a team already covered by a parent. */
  link(teamId: string): void {
    const covered = this.linked().find((l) =>
      l.includeTeamHierarchy && this.audience.descendants(this.teams(), l.teamId).some((d) => d.id === teamId));
    if (covered) {
      this.duplicateError.set(SERVER_MESSAGE.duplicateViaParent(this.teamName(teamId), this.teamName(covered.teamId)));
      return;
    }
    this.duplicateError.set(null);
    this.linked.update((l) => [...l, { teamId, includeTeamHierarchy: false, locked: false, excludedChildIds: [] }]);
    this.teamQuery.set('');
  }

  unlink(teamId: string): void { this.linked.update((l) => l.filter((x) => x.teamId !== teamId)); }

  /** Editable until saved. Once a saved row is locked (see save()), this row no longer renders the checkbox at all. */
  toggleHierarchy(teamId: string): void {
    this.linked.update((l) => l.map((x) => x.teamId === teamId ? { ...x, includeTeamHierarchy: !x.includeTeamHierarchy } : x));
  }

  addUser(userId: string): void {
    this.directUserIds.update((ids) => ids.includes(userId) ? ids : [...ids, userId]);
    this.userQuery.set('');
  }

  removeUser(userId: string): void {
    this.directUserIds.update((ids) => ids.filter((id) => id !== userId));
  }

  /**
   * Copies the template's teams/people into this folder's audience once, then clears the
   * lookup (see DistributionService). Multiple templates can be applied in sequence — each
   * just adds its members on top of whatever is already there, same as adding teams/people directly.
   */
  applyTemplate(templateId: string): void {
    this.distribution.applyToFolder(this.folderId(), templateId).subscribe(() => {
      const tpl = this.templates().find((t) => t.id === templateId);
      if (tpl) {
        this.linked.update((l) => {
          const existing = new Set(l.map((x) => x.teamId));
          const added = tpl.teams
            .filter((t) => !existing.has(t.teamId))
            .map((t) => ({ teamId: t.teamId, includeTeamHierarchy: t.includeTeamHierarchy, locked: false, excludedChildIds: [] }));
          return [...l, ...added];
        });
        this.directUserIds.update((ids) => {
          const existing = new Set(ids);
          return [...ids, ...tpl.userIds.filter((id) => !existing.has(id))];
        });
      }
      this.appliedTemplateIds.update((ids) => ids.includes(templateId) ? ids : [...ids, templateId]);
    });
  }

  /**
   * Persists this step. Any "include sub-teams" that is on at save time locks
   * permanently — a one-way switch, matching the platform rule that the widened
   * audience can't be quietly narrowed again afterwards.
   */
  save(): void {
    this.linked.update((l) => l.map((x) => x.includeTeamHierarchy ? { ...x, locked: true } : x));
    this.continue.emit({ teamCount: this.linked().length, userCount: this.members().length });
  }
}
