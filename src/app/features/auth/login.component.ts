import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LoginComponent as EcapLoginComponent, LoginErrorMeta, StartPageMeta } from '@escriba/cui-ecap-runtime';
import { LanguageService } from '@core/i18n/language.service';
import { SessionService } from '@core/services/session.service';
import { DEFAULT_ROUTE } from '@core/default-route';

/**
 * ECAP-branded header bar + centered sign-in card. The credential form itself
 * is the real ECAP runtime's <lib-ecap-login>; the ::ng-deep rules below skin
 * its internal label/input/button markup since that markup lives in a child
 * component's own template and isn't reachable by plain scoped styles.
 */
@Component({
  selector: 'im-login',
  standalone: true,
  imports: [EcapLoginComponent],
  styles: [`
    .login { min-height: 100vh; display: flex; flex-direction: column; background: var(--bg-2); }

    .header { background: var(--navy-900); padding: 14px 24px; display: flex; align-items: center; gap: 8px; }
    .header .material-icons { color: var(--escriba-teal); font-size: 22px; }
    .header .wordmark { font-size: 16px; font-weight: 800; letter-spacing: .1em; color: #fff; }

    .center { flex: 1; display: grid; place-items: center; padding: 24px; }
    .card {
      width: 380px; background: #fff; border-radius: var(--radius-card); padding: 36px 32px;
      box-shadow: var(--shadow-md); display: flex; flex-direction: column; gap: 4px;
    }
    h1 { margin: 0; font-size: 22px; font-weight: 700; text-align: center; color: var(--fg-1); }
    h2 { margin: 6px 0 24px; font-size: 13px; font-weight: 400; text-align: center; color: var(--fg-3); }

    .error { margin: 0 0 12px; font-size: 13px; color: var(--danger, #c0392b); text-align: center; }
    .copyright { text-align: center; padding: 16px 0 28px; font-size: 12px; color: var(--fg-3); }

    /* --- skin the real <lib-ecap-login> internals (child component templates) --- */
    ::ng-deep lib-ecap-login form { display: flex; flex-direction: column; gap: 16px; }
    ::ng-deep lib-ecap-login .label-container label {
      font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
      color: var(--fg-3); margin-bottom: 6px; display: inline-block;
    }
    ::ng-deep lib-ecap-login .input-field-container {
      background: var(--bg-2); border-radius: var(--radius-input); border: 1px solid transparent;
      transition: border-color 120ms ease;
    }
    ::ng-deep lib-ecap-login .input-field-container:has(input:focus) { border-color: var(--escriba-teal-deep); }
    ::ng-deep lib-ecap-login .input-field-container > div { display: flex; align-items: center; }
    ::ng-deep lib-ecap-login input {
      flex: 1; min-width: 0; border: 0; background: transparent; outline: none;
      padding: 12px 14px; font: inherit; font-size: 14px; color: var(--fg-1);
    }
    ::ng-deep lib-ecap-login .material-icons {
      margin-right: 12px; color: var(--fg-3); cursor: pointer; font-size: 20px;
    }
    ::ng-deep lib-ecap-login .field-error { font-size: 12px; color: var(--danger, #c0392b); }
    ::ng-deep lib-ecap-login button[type="submit"] {
      margin-top: 8px; width: 100%; border: 0; background: var(--escriba-teal); color: var(--navy-900);
      font: inherit; font-size: 15px; font-weight: 700; padding: 13px 16px;
      border-radius: var(--radius-pill); cursor: pointer; transition: background 120ms ease;
    }
    ::ng-deep lib-ecap-login button[type="submit"]:hover { background: var(--escriba-teal-deep); }
  `],
  template: `
    <div class="login">
      <header class="header">
        <i class="material-icons">description</i>
        <span class="wordmark">ECAP</span>
      </header>

      <div class="center">
        <div class="card">
          <h1>{{ lang.isGerman() ? 'Anmelden' : 'Sign In' }}</h1>
          <h2>{{ lang.isGerman() ? 'Geben Sie Ihre Zugangsdaten ein' : 'Enter your credentials to access' }}</h2>

          @if (errorMessage()) {
            <p class="error">{{ errorMessage() }}</p>
          }

          <lib-ecap-login
            (loginSuccessEvent)="onLoginSuccess($event)"
            (loginErrorEvent)="onLoginError($event)" />
        </div>
      </div>

      <p class="copyright">Copyright © {{ year }} Escriba AG</p>
    </div>
  `
})
export class LoginComponent {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  readonly lang = inject(LanguageService);

  readonly year = new Date().getFullYear();
  readonly errorMessage = signal('');

  onLoginSuccess(startPageInfo: StartPageMeta): void {
    this.errorMessage.set('');
    this.router.navigateByUrl(DEFAULT_ROUTE[this.session.role()]);
  }

  onLoginError(error: LoginErrorMeta): void {
    this.errorMessage.set(error.errorMessage);
  }
}
