import { Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { DictKey } from '@core/i18n/dictionary';
import { Role } from '@core/models';
import { SessionService } from '@core/services/session.service';
import { roleLabel } from '@core/role-labels';

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

@Component({
  selector: 'im-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
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

          <div class="rail__foot">
            <span class="eyebrow">{{ lang.isGerman() ? 'ROLLE WECHSELN' : 'SWITCH ROLE' }}</span>
            <div class="rail__roles">
              @for (r of roles; track r) {
                <button type="button" class="rail__role" [class.rail__role--on]="session.role() === r"
                        (click)="session.switchRole(r)">{{ roleLabel(r) }}</button>
              }
            </div>
            <div class="rail__user">
              <span class="rail__avatar">{{ initials() }}</span>
              <span class="rail__userName">{{ session.session().displayName }}</span>
            </div>
            <button type="button" class="rail__logout" (click)="logout()">
              {{ lang.isGerman() ? 'Abmelden' : 'Log out' }}
            </button>
          </div>
        </aside>
      }

      <div class="main">
        @if (showChrome()) {
          <header class="topbar">
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
  private readonly router = inject(Router);
  readonly roles: Role[] = ['kenntnissnahmeempfaenger', 'informationsbereitsteller', 'complianceverantwortlicher'];
  readonly nav = computed(() => NAV[this.session.role()]);

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

  readonly initials = computed(() =>
    this.session.session().displayName.split(' ').slice(-1)[0].slice(0, 2).toUpperCase());

  roleLabel(r: Role): string { return roleLabel(r, this.lang.isGerman()); }

  logout(): void {
    this.session.logout();
    this.router.navigateByUrl('/login');
  }
}
