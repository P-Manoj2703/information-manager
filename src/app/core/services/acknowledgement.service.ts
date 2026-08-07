import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { Acknowledgement, AckStatus } from '../models';
import { DataPort } from './data.port';
import { SessionService } from './session.service';

const ORDER: Record<AckStatus, number> = { Overdue: 0, Pending: 1, Done: 2, Obsolete: 3, None: 4 };

@Injectable({ providedIn: 'root' })
export class AcknowledgementService {
  private readonly data = inject(DataPort);
  private readonly session = inject(SessionService);

  /** Recipient landing list: outstanding first, deadline ascending, overdue pinned. */
  myOutstanding(): Observable<Acknowledgement[]> {
    return this.data.acknowledgements({ userId: this.session.session().userId }).pipe(
      map((list) => list
        .filter((a) => a.acknowledgment_picklist_status === 'Pending' || a.acknowledgment_picklist_status === 'Overdue')
        .sort((a, b) =>
          ORDER[a.acknowledgment_picklist_status] - ORDER[b.acknowledgment_picklist_status] ||
          a.acknowledgement_date_deadline_date.localeCompare(b.acknowledgement_date_deadline_date)))
    );
  }

  /**
   * The recipient has NO update permission on the record. Completion runs
   * exclusively through the BPM user task; the rule set then sets Done.
   */
  confirm(ack: Acknowledgement, comment?: string): Observable<void> {
    if (!ack.taskId) throw new Error('Acknowledgement has no open user task');
    return this.data.completeAckTask(ack.taskId, comment);
  }

  daysOverdue(ack: Acknowledgement, today = new Date()): number {
    const due = new Date(ack.acknowledgement_date_deadline_date);
    return Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86_400_000));
  }
}
