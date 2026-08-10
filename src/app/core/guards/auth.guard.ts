/**
 * Delegates to the ECAP runtime's own guard: waits on LoggedInUserService.userSignal()
 * (undefined = still resolving at boot, object = logged in, null = confirmed logged out)
 * and redirects to /login in the logged-out case.
 */
export { authGuard } from '@escriba/cui-ecap-runtime';
