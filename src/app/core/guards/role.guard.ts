import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Role } from '@core/models';
import { SessionService } from '@core/services/session.service';
import { DEFAULT_ROUTE } from '@core/default-route';

/**
 * Mirrors the Custom Access Criteria: deny, don't just hide. The rejection redirect must be
 * role-aware, not a fixed '/tasks' — '/tasks' is itself guarded to the Recipient role only, so
 * a hardcoded redirect there sent every other role straight back into this same rejection,
 * producing an infinite redirect loop (confirmed via a "Script terminated by timeout" stack
 * trace inside the Router's own event Subject — this was the real cause of the repeated
 * "page freeze" reports for Compliance/Information-provider roles, not app code or the browser).
 */
export function roleGuard(allowed: Role[]): CanActivateFn {
  return () => {
    const session = inject(SessionService);
    const router = inject(Router);
    return allowed.includes(session.role()) ? true : router.createUrlTree([DEFAULT_ROUTE[session.role()]]);
  };
}
