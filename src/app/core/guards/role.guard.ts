import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Role } from '@core/models';
import { SessionService } from '@core/services/session.service';

/** Mirrors the Custom Access Criteria: deny, don't just hide. */
export function roleGuard(allowed: Role[]): CanActivateFn {
  return () => {
    const session = inject(SessionService);
    const router = inject(Router);
    return allowed.includes(session.role()) ? true : router.createUrlTree(['/tasks']);
  };
}
