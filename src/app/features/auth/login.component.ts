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
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
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
