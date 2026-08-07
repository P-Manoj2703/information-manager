import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DataPort } from '@core/services/data.port';
import { AudienceService } from '@core/services/audience.service';
import { LanguageService } from '@core/i18n/language.service';
import { SERVER_MESSAGE } from '@core/server-messages';
import { AppUser, DistributionTemplate, Team } from '@core/models';
import { ProvenancePillComponent } from '@shared/ui/provenance-pill.component';

interface LinkedTeam { teamId: string; includeTeamHierarchy: boolean; }

/**
 * UC-ADM-03. Create or edit a distribution template — a standalone bundle of teams
 * and people that folders can apply later (see AudienceBuilderComponent's template
 * picker). Unlike a folder's own audience, nothing here ever locks: a template
 * isn't a published/frozen record, so "incl. sub-teams" stays freely togglable.
 */
@Component({
  selector: 'im-template-builder',
  standalone: true,
  imports: [RouterLink, ProvenancePillComponent],
  styleUrl: './template-builder.component.scss',
  template: `
    <a class="back" routerLink="/templates">← {{ lang.t('templates') }}</a>

    <section class="card">
      <header class="head">
        <label class="name-field">
          {{ lang.isGerman() ? 'Name der Vorlage' : 'Template name' }} *
          <input [value]="name()" (input)="name.set($any($event.target).value)"
                 [placeholder]="lang.isGerman() ? 'z. B. Alle Standorte DACH' : 'e.g. All DACH locations'">
        </label>
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
                <label class="switch">
                  <input type="checkbox" class="switch__input" [checked]="l.includeTeamHierarchy" (change)="toggleHierarchy(l.teamId)">
                  <span class="switch__track"><span class="switch__thumb"></span></span>
                  <span class="switch__label">{{ lang.isGerman() ? 'inkl. Unterteams' : 'incl. sub-teams' }}</span>
                </label>
                <button type="button" class="x" (click)="unlink(l.teamId)" aria-label="remove">×</button>
              </div>

              @if (l.includeTeamHierarchy && childTeams(l.teamId).length) {
                <ul class="tree">
                  @for (c of childTeams(l.teamId); track c.id) {
                    <li>
                      <span>{{ c.information_manager_teams_textfield_name }}</span>
                      <span class="tree__count">{{ lang.isGerman() ? 'automatisch verknüpft' : 'auto-linked' }} · {{ c.memberCount }}</span>
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

      <footer>
        <a class="ghost" routerLink="/templates">{{ lang.isGerman() ? 'Abbrechen' : 'Cancel' }}</a>
        <button type="button" class="primary" [disabled]="!name().trim() || saving()" (click)="save()">
          {{ lang.isGerman() ? 'Speichern' : 'Save' }}
        </button>
      </footer>
    </section>
  `
})
export class TemplateBuilderComponent {
  private readonly data = inject(DataPort);
  private readonly audience = inject(AudienceService);
  private readonly router = inject(Router);
  readonly lang = inject(LanguageService);

  readonly id = input<string>('');

  readonly name = signal('');
  readonly linked = signal<LinkedTeam[]>([]);
  readonly directUserIds = signal<string[]>([]);
  readonly duplicateError = signal<string | null>(null);
  readonly teamQuery = signal('');
  readonly userQuery = signal('');
  readonly showTeamPicker = signal(false);
  readonly showUserPicker = signal(false);
  readonly saving = signal(false);

  private readonly teams = toSignal(this.data.teams(), { initialValue: [] as Team[] });
  private readonly users = toSignal(this.data.users(), { initialValue: [] as AppUser[] });
  private readonly templates = toSignal(this.data.templates(), { initialValue: [] as DistributionTemplate[] });

  private seeded = false;
  /** One-time seed once the existing template shows up in the list — edits afterwards are local. */
  private readonly seedFromExisting = effect(() => {
    if (this.seeded || !this.id()) return;
    const tpl = this.templates().find((t) => t.id === this.id());
    if (!tpl) return;
    this.name.set(tpl.name);
    this.linked.set(tpl.teams.map((t) => ({ ...t })));
    this.directUserIds.set([...tpl.userIds]);
    this.seeded = true;
  }, { allowSignalWrites: true });

  /** Same dedup/provenance algorithm as AudienceBuilderComponent. */
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
        this.audience.descendants(this.teams(), l.teamId).forEach((child) =>
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

  rowCounts(l: LinkedTeam): { direct: number; fromSubTeams: number } {
    const direct = this.teamMemberCount(l.teamId);
    const fromSubTeams = l.includeTeamHierarchy
      ? this.audience.descendants(this.teams(), l.teamId).reduce((sum, c) => sum + c.memberCount, 0)
      : 0;
    return { direct, fromSubTeams };
  }

  childTeams = (teamId: string): Team[] => this.audience.descendants(this.teams(), teamId);

  link(teamId: string): void {
    const covered = this.linked().find((l) =>
      l.includeTeamHierarchy && this.audience.descendants(this.teams(), l.teamId).some((d) => d.id === teamId));
    if (covered) {
      this.duplicateError.set(SERVER_MESSAGE.duplicateViaParent(this.teamName(teamId), this.teamName(covered.teamId)));
      return;
    }
    this.duplicateError.set(null);
    this.linked.update((l) => [...l, { teamId, includeTeamHierarchy: false }]);
    this.teamQuery.set('');
  }

  unlink(teamId: string): void { this.linked.update((l) => l.filter((x) => x.teamId !== teamId)); }

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

  save(): void {
    if (!this.name().trim()) return;
    this.saving.set(true);
    this.data.saveTemplate({
      id: this.id() || undefined,
      name: this.name().trim(),
      teams: this.linked(),
      userIds: this.directUserIds()
    }).subscribe(() => {
      this.saving.set(false);
      this.router.navigateByUrl('/templates');
    });
  }
}
