import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { RoleMeta, RoleSwitchDirective } from '@escriba/cui-ecap-runtime';
import { LanguageService } from '@core/i18n/language.service';
import { DictKey } from '@core/i18n/dictionary';
import { Role } from '@core/models';
import { SessionService, ROLE_ID_TO_ROLE } from '@core/services/session.service';
import { PageSubtitleService } from '@core/services/page-subtitle.service';
import { roleLabel } from '@core/role-labels';
import { DEFAULT_ROUTE } from '@core/default-route';

interface NavItem { path: string; key: DictKey; }

const NAV: Record<Role, NavItem[]> = {
  kenntnissnahmeempfaenger: [
    { path: '/tasks', key: 'myAcknowledgements' },
    { path: '/documents', key: 'documents' }
  ],
  informationsbereitsteller: [
    { path: '/folders', key: 'folders' },
    { path: '/acknowledgements', key: 'acknowledgements' },
    { path: '/templates', key: 'templates' }
  ],
  complianceverantwortlicher: [
    { path: '/estate', key: 'estate' },
    { path: '/acknowledgements', key: 'acknowledgements' },
    { path: '/monitoring', key: 'monitoring' }
  ]
};

interface PageHeader { titleKey: DictKey; subtitleDe: string; subtitleEn: string; }

/**
 * The page title/subtitle now lives in the topbar (left-aligned, alongside the DE/EN toggle on
 * the right) instead of inside each page's own content — moved here per explicit request so
 * every top-level list page shows it in the same place. Exact-path match only: sub-pages
 * (folder detail, template detail, etc.) already have their own in-page back-links/headers and
 * intentionally show no title here.
 */
const PAGE_HEADERS: Record<string, PageHeader> = {
  '/folders': { titleKey: 'folders', subtitleDe: 'Eigene und Team-Ordner', subtitleEn: 'Own and team folders' },
  '/estate': { titleKey: 'estate', subtitleDe: 'Alle Informationsmappen im Tenant', subtitleEn: 'All information folders in the tenant' },
  '/documents': { titleKey: 'documents', subtitleDe: 'Meine zugewiesenen Dokumentversionen', subtitleEn: 'My assigned document versions' },
  // '/tasks' has no static subtitle here — task-list.component.ts overrides it with real open/overdue counts via PageSubtitleService.
  '/tasks': { titleKey: 'myAcknowledgements', subtitleDe: '', subtitleEn: '' },
  '/acknowledgements': { titleKey: 'acknowledgements', subtitleDe: 'Verfolgung auf Personenebene', subtitleEn: 'Person-level tracking' },
  '/templates': { titleKey: 'templates', subtitleDe: 'Wiederverwendbare Zielgruppen', subtitleEn: 'Reusable audiences' },
  '/monitoring': { titleKey: 'monitoring', subtitleDe: 'Unternehmensweite Kenntnisnahme-Übersicht und Erinnerungen', subtitleEn: 'Company-wide acknowledgement oversight and reminders' }
};

@Component({
  selector: 'im-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, RoleSwitchDirective],
  styleUrl: './shell.component.scss',
  template: `
    <div class="shell">
      @if (showChrome()) {
        <aside class="rail">
          <div class="rail__brand">
            <span class="rail__wordmark">ESCRIBA</span>
            <span class="rail__sub">{{ lang.t('appName') }}</span>
          </div>

          <nav class="rail__nav">
            @for (item of nav(); track item.path) {
              <a class="rail__link" [routerLink]="item.path" routerLinkActive="rail__link--on">
                {{ lang.t(item.key) }}
              </a>
            }
          </nav>

          <div class="rail__foot" libEcapRuntimeRoleSwitch #roleSwitch="libEcapRuntimeRoleSwitch"
               (apiErrorEvent)="onRoleSwitchError($event)">
            <span class="eyebrow">{{ lang.isGerman() ? 'ROLLE WECHSELN' : 'SWITCH ROLE' }}</span>
            <div class="rail__roles">
              @for (r of roleSwitch.roleList; track r.id) {
                @if (roleFor(r.id); as role) {
                  <button type="button" class="rail__role" [class.rail__role--on]="!!r.isActive"
                          [disabled]="roleSwitch.callInProgress" (click)="onRoleClick(roleSwitch, r)">
                    {{ roleLabel(role) }}
                  </button>
                }
              }
            </div>
            @if (roleSwitchError()) { <p class="rail__role-error">{{ roleSwitchError() }}</p> }
            <div class="rail__user">
              <span class="rail__avatar">{{ initials() }}</span>
              <span class="rail__userName">{{ session.session().displayName }}</span>
              <button type="button" class="rail__logout" (click)="logout()"
                      [attr.aria-label]="lang.isGerman() ? 'Abmelden' : 'Log out'"
                      [attr.title]="lang.isGerman() ? 'Abmelden' : 'Log out'">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M6 2H3.5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1H6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M10.5 11 14 8l-3.5-3M14 8H6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        </aside>
      }

      <div class="main">
        @if (showChrome()) {
          <header class="topbar">
            @if (pageHeader(); as h) {
              <div class="topbar__title">
                <h1>{{ lang.t(h.titleKey) }}</h1>
                <p class="subtitle">{{ pageSubtitle.override() ?? (lang.isGerman() ? h.subtitleDe : h.subtitleEn) }}</p>
              </div>
            }
            <span class="spacer"></span>
            <div class="topbar__lang" role="group" aria-label="Sprache">
              <button type="button" [class.on]="lang.isGerman()" (click)="lang.set('de')">DE</button>
              <button type="button" [class.on]="!lang.isGerman()" (click)="lang.set('en')">EN</button>
            </div>
          </header>
        }
        <main class="content"><router-outlet /></main>
      </div>
    </div>
  `
})
export class ShellComponent {
  readonly session = inject(SessionService);
  readonly lang = inject(LanguageService);
  readonly pageSubtitle = inject(PageSubtitleService);
  private readonly router = inject(Router);
  readonly nav = computed(() => NAV[this.session.role()]);
  readonly roleSwitchError = signal('');

  /**
   * Route-based, not session-based: session.loggedOut() depends on the real
   * ECAP startPage signal resolving, which can stay unresolved while still on
   * /login (no backend in this environment) — that left the rail rendered
   * behind the login card. The current URL is known immediately.
   */
  private readonly currentUrl = toSignal(
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)),
    { initialValue: null }
  );
  readonly showChrome = computed(() =>
    !(this.currentUrl()?.urlAfterRedirects ?? this.router.url).startsWith('/login'));

  readonly pageHeader = computed(() => {
    const path = (this.currentUrl()?.urlAfterRedirects ?? this.router.url).split('?')[0];
    if (/^\/tasks\/[^/]+$/.test(path)) {
      return {
        titleKey: 'acknowledgement' as const,
        subtitleDe: 'Aufgabe aus dem Kenntnisnahme-Abschlussprozess',
        subtitleEn: 'Task from the Acknowledgment Completion process'
      };
    }
    if (/^\/folders\/[^/]+$/.test(path)) {
      // Real subtitle (the folder's own name) comes from folder-detail.component.ts via PageSubtitleService.
      return { titleKey: 'informationFolder' as const, subtitleDe: '', subtitleEn: '' };
    }
    if (/^\/folders\/[^/]+\/versions\/new$/.test(path)) {
      // Real subtitle (the folder's own name) comes from version-form.component.ts via PageSubtitleService.
      return { titleKey: 'newVersion' as const, subtitleDe: '', subtitleEn: '' };
    }
    return PAGE_HEADERS[path] ?? null;
  });

  readonly initials = computed(() =>
    this.session.session().displayName.split(' ').slice(-1)[0].slice(0, 2).toUpperCase());

  roleLabel(r: Role): string { return roleLabel(r, this.lang.isGerman()); }

  /**
   * ECAP's real per-app role assignment (RoleSwitchDirective.roleList) can include roles this
   * UI has no view for (e.g. 'administrator' — see ROLE_ID's own comment) — only ever offer
   * the ones this app actually maps to a role, so the switcher can't show a dead option.
   */
  roleFor(roleId: string): Role | null {
    return ROLE_ID_TO_ROLE[roleId] ?? null;
  }

  /**
   * Real role switch against ECAP (RoleSwitchDirective.changeRole), not a local override —
   * it updates the same LoggedInUserService signal SessionService reads, so session.role()
   * picks up the change on its own. Navigates to the new role's own landing page since the
   * page currently open may not exist under it (e.g. Recipient has no /folders route).
   */
  onRoleClick(roleSwitch: RoleSwitchDirective, r: RoleMeta): void {
    if (r.isActive || roleSwitch.callInProgress) return;
    const role = this.roleFor(r.id);
    if (!role) return;
    this.roleSwitchError.set('');
    roleSwitch.changeRole(r.id)
      .then(() => this.router.navigateByUrl(DEFAULT_ROUTE[role]))
      .catch((err) => {
        console.error('Role switch failed', err);
        this.roleSwitchError.set(this.lang.isGerman() ? 'Rollenwechsel fehlgeschlagen.' : 'Role switch failed.');
      });
  }

  onRoleSwitchError(error: unknown): void {
    console.error('Role switch failed', error);
    this.roleSwitchError.set(this.lang.isGerman() ? 'Rollenwechsel fehlgeschlagen.' : 'Role switch failed.');
  }

  logout(): void {
    this.session.logout();
    this.router.navigateByUrl('/login');
  }
}
