import { AppRole } from './enums';

/** Object id dad21150dc4c4c378819d3ae5f4218e8 — app-local mirror of platform users. */
export interface AppUser {
  id: string;
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
  /** Lookup to the platform user record. */
  platformUserId: string;
  active: boolean;
  primaryTeamId: string;
  primaryTeamName?: string;
  roles: AppRole[];
}
