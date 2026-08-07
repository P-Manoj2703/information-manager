/** Object id 45aed8d75ae542179befff2799f36532 — reusable audience. */
export interface DistributionTemplate {
  id: string;
  name: string;
  userIds: string[];
  teams: { teamId: string; includeTeamHierarchy: boolean }[];
  /** Derived, for the "resolves to N people" counter. */
  resolvedPeopleCount?: number;
  usedByFolderCount?: number;
}
