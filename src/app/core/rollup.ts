import { AckStatus } from './models';

/**
 * AcknowledgementUtil.syncAcknowledgementStatusToInformationFolder
 * Priority: Overdue > Pending > Done (only if all) > Obsolete (only if all) > None.
 * Some-done-but-not-all resolves to Pending. No active version ⇒ None.
 */
export function rollUp(statuses: AckStatus[]): AckStatus {
  if (statuses.length === 0) return 'None';
  if (statuses.includes('Overdue')) return 'Overdue';
  if (statuses.includes('Pending')) return 'Pending';
  if (statuses.every((s) => s === 'Done')) return 'Done';
  if (statuses.every((s) => s === 'Obsolete')) return 'Obsolete';
  return 'Pending';
}

export interface Completion { done: number; pending: number; overdue: number; obsolete: number; total: number; pct: number; }

export function completion(statuses: AckStatus[]): Completion {
  const count = (s: AckStatus) => statuses.filter((x) => x === s).length;
  const total = statuses.length;
  const done = count('Done');
  return {
    done, pending: count('Pending'), overdue: count('Overdue'), obsolete: count('Obsolete'),
    total, pct: total ? Math.round((done / total) * 100) : 0
  };
}
