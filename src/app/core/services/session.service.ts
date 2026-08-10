import { Injectable, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, filter, map, of, switchMap } from 'rxjs';
import { LoggedInUserService } from '@escriba/cui-core';
import { LogoutService, LookupService } from '@escriba/cui-ecap-runtime';
import { Role } from '../models';
import { OBJECT_ID, ROLE_ID } from '../objects';

export interface Session { userId: string; displayName: string; role: Role; primaryTeamId: string; }

const TABS: Record<Role, string[]> = {
  informationsbereitsteller: ['folders', 'acknowledgements', 'templates'],
  complianceverantwortlicher: ['estate', 'acknowledgements', 'monitoring'],
  kenntnissnahmeempfaenger: ['tasks', 'documents']
};

const ROLE_ID_TO_ROLE: Record<string, Role> = {
  [ROLE_ID.informationsbereitsteller]: 'informationsbereitsteller',
  [ROLE_ID.complianceverantwortlicher]: 'complianceverantwortlicher',
  [ROLE_ID.kenntnissnahmeempfaenger]: 'kenntnissnahmeempfaenger'
};

const FALLBACK_ROLE: Role = 'kenntnissnahmeempfaenger';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly userService = inject(LoggedInUserService);
  private readonly logoutService = inject(LogoutService);
  private readonly lookupService = inject(LookupService);

  /** QA-only override so testers can preview other roles' views without separate ECAP accounts per role. See folder-list/nav usage. */
  private readonly _roleOverride = signal<Role | null>(null);

  /** undefined = still resolving at boot, null = confirmed logged out, object = the real StartPageMeta. */
  private readonly startPage = computed(() => this.userService.userSignal());

  /**
   * StartPage only gives a team display name (userData.primary_team_name), not an id —
   * resolved via a Team lookup, same {id,name} pattern as the Responsible team picker
   * in folder-wizard. Pure reactive pipeline (toObservable/switchMap/toSignal) —
   * deliberately not an effect()+subscribe()+signal.set(), to avoid any risk of a
   * signal-write-during-effect cycle.
   */
  private readonly primaryTeamName = computed(() => (this.startPage() as any)?.userData?.primary_team_name ?? '');
  private readonly primaryTeamId = toSignal(
    toObservable(this.primaryTeamName).pipe(
      filter((name): name is string => !!name),
      switchMap((name) => this.lookupService.getLookupTableData(OBJECT_ID.teams, {
        filter: `(name equals '${name}')`, fieldList: 'id,name', page: 1, pageSize: 1, alt: 'json'
      }).pipe(
        map((response: any): string => {
          const rows = [response?.platform?.record || []].flat();
          return rows[0]?.id ?? '';
        }),
        catchError((err) => { console.error('Primary team lookup failed', err); return of(''); })
      ))
    ),
    { initialValue: '' }
  );

  readonly session = computed<Session>(() => {
    const startPage = this.startPage() as any;
    const userData = startPage?.userData ?? {};
    const appInfo = startPage?.appInfo ?? {};
    return {
      userId: userData.id ?? '',
      displayName: userData.full_name ?? '',
      role: this._roleOverride() ?? ROLE_ID_TO_ROLE[appInfo.currentRoleId] ?? FALLBACK_ROLE,
      primaryTeamId: this.primaryTeamId()
    };
  });

  readonly role = computed(() => this.session().role);
  readonly tabs = computed(() => TABS[this.role()]);
  readonly loggedOut = computed(() => this.startPage() === null);

  readonly canCreateFolder = computed(() => this.role() === 'informationsbereitsteller');
  /** Compliance is the only role allowed to update an Acknowledgement. */
  readonly canOverrideAck = computed(() => this.role() === 'complianceverantwortlicher');
  /** Hard-blocked in Java for recipients — hide the control, don't disable it. */
  readonly canUploadFiles = computed(() => this.role() !== 'kenntnissnahmeempfaenger');
  /** No role in this rollout may create/edit users or teams. */
  readonly canEditUsersAndTeams = computed(() => false);

  /** QA-only: preview another role's views without a separate ECAP account. Does not change the real ECAP session. */
  switchRole(role: Role): void {
    this._roleOverride.set(role);
  }

  /** Ends the real ECAP session (server-side logout + clears LoggedInUserService), then authGuard sends the router to /login. */
  logout(): void {
    this._roleOverride.set(null);
    this.logoutService.logout();
  }
}
