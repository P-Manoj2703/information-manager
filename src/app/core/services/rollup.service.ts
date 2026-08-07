import { Injectable } from '@angular/core';
import { AcknowledgmentStatus } from '@core/models';

/**
 * AcknowledgementUtil.syncAcknowledgementStatusToInformationFolder.
 * Priority over the acknowledgements of the folder's ACTIVE version:
 * Overdue > Pending > Done (only when all) > Obsolete (only when all) > None.
 */
@Injectable({ providedIn: 'root' })
export class RollupService {
  compute(statuses: AcknowledgmentStatus[]): AcknowledgmentStatus {
    if (statuses.length === 0) return 'None';
    if (statuses.includes('Overdue')) return 'Overdue';
    if (statuses.includes('Pending')) return 'Pending';
    if (statuses.every((s) => s === 'Done')) return 'Done';
    if (statuses.every((s) => s === 'Obsolete')) return 'Obsolete';
    return 'Pending';
  }

  completion(statuses: AcknowledgmentStatus[]): { done: number; pending: number; overdue: number; percent: number } {
    const done = statuses.filter((s) => s === 'Done').length;
    const pending = statuses.filter((s) => s === 'Pending').length;
    const overdue = statuses.filter((s) => s === 'Overdue').length;
    const relevant = done + pending + overdue;
    return { done, pending, overdue, percent: relevant ? Math.round((done / relevant) * 100) : 0 };
  }
}
