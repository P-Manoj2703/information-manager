export interface Team {
  id: string;
  information_manager_teams_textfield_name: string;
  parent_team_id: string | null;
  memberCount: number;
}

export interface AppUser {
  id: string;
  firstName: string;
  lastName: string;
  userName: string;
  email: string;
  primaryTeamId: string;
  active: boolean;
}

/** Junction Folder↔Team, carries the hierarchy flag. */
export interface OrganizationalUnit {
  id: string;
  folderId: string;
  teamId: string;
  includeTeamHierarchy: boolean;
  /** Set by the server when the row was created by hierarchy expansion. */
  autoLinked: boolean;
}

export interface DistributionTemplate {
  id: string;
  name: string;
  teams: { teamId: string; includeTeamHierarchy: boolean }[];
  userIds: string[];
}

export type Provenance = 'direct' | 'team' | 'hierarchy';

export interface AudienceMember {
  user: AppUser;
  provenance: Provenance;
  viaTeamId?: string;
}
