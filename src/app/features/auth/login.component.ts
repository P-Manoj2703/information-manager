import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { LanguageService } from '@core/i18n/language.service';
import { SessionService } from '@core/services/session.service';
import { Role } from '@core/models';
import { roleLabel } from '@core/role-labels';
import { DEFAULT_ROUTE } from '@core/default-route';

/** Prototype stand-in for real ECAP auth — picking a role signs back in as that role's profile. */
@Component({
  selector: 'im-login',
  standalone: true,
  styles: [`
    .login { min-height: 100vh; display: grid; place-items: center; background: var(--navy-900); }
    .card {
      width: 380px; background: #fff; border-radius: var(--radius-card); padding: 36px 32px;
      display: flex; flex-direction: column; gap: 8px; text-align: center;
    }
    .brand { font-size: 16px; font-weight: 800; letter-spacing: .14em; color: var(--escriba-teal-700); }
    h1 { margin: 4px 0 0; font-size: 20px; font-weight: 300; }
    p { margin: 0 0 12px; font-size: 13px; color: var(--fg-3); line-height: 1.6; }
    .roles { display: flex; flex-direction: column; gap: 8px; }
    button {
      border: 1px solid var(--border-1); background: #fff; cursor: pointer; font: inherit;
      font-size: 14px; font-weight: 600; padding: 12px 16px; border-radius: var(--radius-input);
      color: var(--fg-1); transition: background 120ms ease;
    }
    button:hover { background: var(--bg-mint); border-color: var(--escriba-teal-deep); }
  `],
  template: `
    <div class="login">
      <div class="card">
        <span class="brand">ESCRIBA</span>
        <h1>{{ lang.t('appName') }}</h1>
        <p>{{ lang.isGerman()
          ? 'Sie wurden abgemeldet. Melden Sie sich erneut an, um fortzufahren.'
          : 'You have been logged out. Sign in again to continue.' }}</p>
        <div class="roles">
          @for (r of roles; track r) {
            <button type="button" (click)="loginAs(r)">{{ roleLabel(r) }}</button>
          }
        </div>
      </div>
    </div>
  `
})
export class LoginComponent {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  readonly lang = inject(LanguageService);

  readonly roles: Role[] = ['kenntnissnahmeempfaenger', 'informationsbereitsteller', 'complianceverantwortlicher'];

  roleLabel(r: Role): string { return roleLabel(r, this.lang.isGerman()); }

  loginAs(role: Role): void {
    this.session.login(role);
    this.router.navigateByUrl(DEFAULT_ROUTE[role]);
  }
}
