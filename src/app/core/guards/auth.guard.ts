import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from '@core/services/session.service';

/** Sends logged-out users to /login instead of any guarded route. */
export const authGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  return session.loggedOut() ? router.createUrlTree(['/login']) : true;
};
