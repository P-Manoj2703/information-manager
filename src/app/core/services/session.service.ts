import { Injectable, computed, signal } from '@angular/core';
import { Role } from '../models';

export interface Session { userId: string; displayName: string; role: Role; primaryTeamId: string; }

const TABS: Record<Role, string[]> = {
  informationsbereitsteller: ['folders', 'acknowledgements', 'templates'],
  complianceverantwortlicher: ['estate', 'acknowledgements', 'monitoring'],
  kenntnissnahmeempfaenger: ['tasks', 'documents']
};

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly _session = signal<Session>({
    userId: 'u-anna', displayName: 'Anna Vogt',
    role: 'kenntnissnahmeempfaenger', primaryTeamId: 't1'
  });
  private readonly _loggedOut = signal(false);

  readonly session = this._session.asReadonly();
  readonly role = computed(() => this._session().role);
  readonly tabs = computed(() => TABS[this._session().role]);
  readonly loggedOut = this._loggedOut.asReadonly();

  readonly canCreateFolder = computed(() => this._session().role === 'informationsbereitsteller');
  /** Compliance is the only role allowed to update an Acknowledgement. */
  readonly canOverrideAck = computed(() => this._session().role === 'complianceverantwortlicher');
  /** Hard-blocked in Java for recipients — hide the control, don't disable it. */
  readonly canUploadFiles = computed(() =>
    this._session().role !== 'kenntnissnahmeempfaenger');
  /** No role in this rollout may create/edit users or teams. */
  readonly canEditUsersAndTeams = computed(() => false);

  switchRole(role: Role): void {
    const profiles: Record<Role, Session> = {
      kenntnissnahmeempfaenger: { userId: 'u-anna', displayName: 'Anna Vogt', role, primaryTeamId: 't1' },
      informationsbereitsteller: { userId: 'u-markus', displayName: 'Markus Bauer', role, primaryTeamId: 't5' },
      complianceverantwortlicher: { userId: 'u-petra', displayName: 'Dr. Petra Lindner', role, primaryTeamId: 't4' }
    };
    this._session.set(profiles[role]);
  }

  /** Clears the session and sends the router to /login. See auth.guard.ts. */
  logout(): void {
    this._loggedOut.set(true);
    // TODO(ECAP integration): also call the tenant's session/logout endpoint here.
  }

  login(role: Role): void {
    this._loggedOut.set(false);
    this.switchRole(role);
  }
}
