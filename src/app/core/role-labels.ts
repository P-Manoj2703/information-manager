import { Role } from './models';

export const ROLE_LABEL: Record<Role, [string, string]> = {
  kenntnissnahmeempfaenger: ['Kenntnisnahmeempfänger', 'Recipient'],
  informationsbereitsteller: ['Informationsbereitsteller', 'Information provider'],
  complianceverantwortlicher: ['Complianceverantwortlicher', 'Compliance officer']
};

export function roleLabel(role: Role, german: boolean): string {
  return ROLE_LABEL[role][german ? 0 : 1];
}
