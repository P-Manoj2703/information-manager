import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LoginComponent as EcapLoginComponent, LoginErrorMeta, StartPageMeta } from '@escriba/cui-ecap-runtime';
import { LanguageService } from '@core/i18n/language.service';
import { SessionService } from '@core/services/session.service';
import { DEFAULT_ROUTE } from '@core/default-route';

/**
 * Plain background with a small corner logo mark (top-left) and a centered card —
 * modeled directly on ECAP's own native login page, per explicit request, but kept on this
 * app's own token palette (navy-900/escriba-teal/etc.) instead of ECAP's blue. The credential
 * form itself is the real ECAP runtime's <lib-ecap-login>; the ::ng-deep rules below skin its
 * internal label/input/button markup since that markup lives in a child component's own
 * template and isn't reachable by plain scoped styles.
 */
@Component({
  selector: 'im-login',
  standalone: true,
  imports: [EcapLoginComponent],
  styles: [`
    /* position:fixed + inset:0 pins this to the exact viewport rectangle regardless of any
       ancestor's own margin/padding/width quirks — the mint bar and the scrollbar issues seen
       previously both trace back to relying on height:100vh alone, which only matches the
       viewport's size, not its actual position. This can't drift from the viewport edges or
       leave anything to scroll. */
    .login { position: fixed; inset: 0; overflow: hidden; display: flex; flex-direction: column; background: var(--bg-2); }

    .mark { flex: 0 0 auto; background: var(--bg-mint); padding: 20px 32px; }
    .mark .wordmark { font-size: 26px; font-weight: 700; letter-spacing: normal; color: var(--fg-1); }

    .center { flex: 1 1 auto; min-height: 0; display: grid; place-items: center; padding: 12px 24px; }
    .card {
      width: 400px; max-height: 100%; overflow: auto; background: #fff; border-radius: var(--radius-card);
      padding: 32px 36px; box-shadow: var(--shadow-md); display: flex; flex-direction: column; gap: 4px;
    }
    h1, h2 { margin: 0; font-size: 28px; font-weight: 700; letter-spacing: normal; color: var(--fg-1); line-height: 1.3; }
    h2 { margin-bottom: 22px; }

    .error { margin: 0 0 12px; font-size: 13px; color: var(--danger, #c0392b); text-align: center; }

    /* --- skin the real <lib-ecap-login> internals (child component templates) --- */
    ::ng-deep lib-ecap-login form { display: flex; flex-direction: column; gap: 18px; }
    ::ng-deep lib-ecap-login .label-container label {
      font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
      color: var(--fg-3); margin-bottom: 6px; display: inline-block;
    }
    ::ng-deep lib-ecap-login .input-field-container {
      background: #fff; border-radius: var(--radius-input); border: 1px solid var(--border-2);
      transition: border-color 120ms ease;
    }
    ::ng-deep lib-ecap-login .input-field-container:has(input:focus) { border-color: var(--escriba-teal-deep); }
    ::ng-deep lib-ecap-login .input-field-container > div { display: flex; align-items: center; }
    ::ng-deep lib-ecap-login input {
      flex: 1; min-width: 0; border: 0; background: transparent; outline: none;
      padding: 13px 14px; font: inherit; font-size: 14.5px; color: var(--fg-1);
    }
    ::ng-deep lib-ecap-login .material-icons {
      margin-right: 12px; color: var(--fg-3); cursor: pointer; font-size: 20px;
    }
    ::ng-deep lib-ecap-login .field-error { font-size: 12px; color: var(--danger, #c0392b); }
    ::ng-deep lib-ecap-login button[type="submit"] {
      margin-top: 10px; width: 100%; border: 0; background: var(--escriba-teal); color: var(--navy-900);
      font: inherit; font-size: 15px; font-weight: 700; letter-spacing: .01em; padding: 14px 16px;
      border-radius: var(--radius-input); cursor: pointer; transition: background 120ms ease;
    }
    ::ng-deep lib-ecap-login button[type="submit"]:hover { background: var(--escriba-teal-deep); }
  `],
  template: `
    <div class="login">
      <div class="mark">
        <span class="wordmark">ECAP</span>
      </div>

      <div class="center">
        <div class="card">
          <h1>{{ lang.isGerman() ? 'WILLKOMMEN' : 'WELCOME' }}</h1>
          <h2>{{ lang.isGerman() ? 'BITTE ANMELDEN' : 'PLEASE LOGIN' }}</h2>

          @if (errorMessage()) {
            <p class="error">{{ errorMessage() }}</p>
          }

          <lib-ecap-login
            (loginSuccessEvent)="onLoginSuccess($event)"
            (loginErrorEvent)="onLoginError($event)" />
        </div>
      </div>
    </div>
  `
})
export class LoginComponent {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  readonly lang = inject(LanguageService);

  readonly errorMessage = signal('');

  onLoginSuccess(startPageInfo: StartPageMeta): void {
    this.errorMessage.set('');
    this.router.navigateByUrl(DEFAULT_ROUTE[this.session.role()]);
  }

  onLoginError(error: LoginErrorMeta): void {
    this.errorMessage.set(error.errorMessage);
  }
}
