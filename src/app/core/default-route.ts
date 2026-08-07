import { Role } from './models';

/** Landing route per role after login — must stay inside that role's roleGuard allow-list in app.routes.ts. */
export const DEFAULT_ROUTE: Record<Role, string> = {
  kenntnissnahmeempfaenger: '/tasks',
  informationsbereitsteller: '/folders',
  complianceverantwortlicher: '/estate'
};
