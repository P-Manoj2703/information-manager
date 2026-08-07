import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Acknowledgement, AckStatus } from '@core/models';
import { DataPort } from '@core/services/data.port';
import { SessionService } from '@core/services/session.service';
import { AcknowledgementService } from '@core/services/acknowledgement.service';
import { LanguageService } from '@core/i18n/language.service';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { FilterChipsComponent, Chip } from '@shared/ui/filter-chips.component';
import { EmptyStateComponent } from '@shared/ui/empty-state.component';

const ORDER: Record<AckStatus, number> = { Overdue: 0, Pending: 1, Done: 2, Obsolete: 3, None: 4 };

@Component({
  selector: 'im-task-list',
  standalone: true,
  imports: [RouterLink, StatusBadgeComponent, FilterChipsComponent, EmptyStateComponent],
  styleUrl: './task-list.component.scss',
  template: `
    <section class="page">
      <div class="kpis">
        <div class="kpi"><span class="eyebrow">{{ lang.isGerman() ? 'OFFEN' : 'OPEN' }}</span><strong>{{ counts().open }}</strong></div>
        <div class="kpi kpi--danger"><span class="eyebrow">{{ lang.isGerman() ? 'ÜBERFÄLLIG' : 'OVERDUE' }}</span><strong>{{ counts().overdue }}</strong></div>
        <div class="kpi"><span class="eyebrow">{{ lang.isGerman() ? 'ERLEDIGT' : 'DONE' }}</span><strong>{{ counts().done }}</strong></div>
      </div>

      <im-filter-chips [chips]="chips()" [(value)]="filter" />

      <ul class="list">
        @for (a of visible(); track a.id) {
          <li class="item" [class.item--overdue]="a.acknowledgment_picklist_status === 'Overdue'">
            <div class="item__body">
              <div class="item__meta">
                <im-status-badge [status]="a.acknowledgment_picklist_status" />
                <span class="mono chip">{{ a.documentversion_record }}</span>
                <span class="due" [class.due--late]="a.acknowledgment_picklist_status === 'Overdue'">{{ due(a) }}</span>
              </div>
              <h2>{{ a.acknowledgement_textfield_information_folder_name }}</h2>
              <p [innerHTML]="a.acknowledgment_richtextarea_user_information"></p>
            </div>
            <a class="btn" [routerLink]="['/tasks', a.id]">
              {{ lang.isGerman() ? 'Öffnen und bestätigen' : 'Open and confirm' }}
            </a>
          </li>
        } @empty {
          <im-empty-state [title]="lang.isGerman() ? 'Nichts zu tun' : 'Nothing to do'"
                          [body]="lang.isGerman() ? 'Sie haben in dieser Ansicht keine offenen Kenntnisnahmen.' : 'You have no outstanding acknowledgements in this view.'" />
        }
      </ul>
    </section>
  `
})
export class TaskListComponent {
  private readonly data = inject(DataPort);
  private readonly session = inject(SessionService);
  private readonly acks = inject(AcknowledgementService);
  readonly lang = inject(LanguageService);

  /** Deliberate deviation: the tenant default view is My Completed. */
  readonly filter = signal<string>('open');

  private readonly all = toSignal(
    this.data.acknowledgements({ userId: this.session.session().userId }), { initialValue: [] as Acknowledgement[] });

  readonly counts = computed(() => {
    const s = this.all().map((a) => a.acknowledgment_picklist_status);
    return {
      open: s.filter((x) => x === 'Pending' || x === 'Overdue').length,
      overdue: s.filter((x) => x === 'Overdue').length,
      done: s.filter((x) => x === 'Done').length
    };
  });

  /** Only the 4 categories recipients care about: Open/Pending, Overdue, Done. No "All", no Obsolete/None. */
  readonly chips = computed<Chip[]>(() => [
    { id: 'open', label: this.lang.t('pending') },
    { id: 'overdue', label: this.lang.t('overdue') },
    { id: 'done', label: this.lang.t('done') }
  ]);

  readonly visible = computed(() => {
    const f = this.filter();
    return this.all()
      .filter((a) => {
        const s = a.acknowledgment_picklist_status;
        if (f === 'overdue') return s === 'Overdue';
        if (f === 'done') return s === 'Done';
        return s === 'Pending' || s === 'Overdue';
      })
      .sort((a, b) =>
        ORDER[a.acknowledgment_picklist_status] - ORDER[b.acknowledgment_picklist_status] ||
        a.acknowledgement_date_deadline_date.localeCompare(b.acknowledgement_date_deadline_date));
  });

  due(a: Acknowledgement): string {
    const de = this.lang.isGerman();
    if (a.acknowledgment_picklist_status === 'Overdue') {
      const n = this.acks.daysOverdue(a);
      return de ? `Seit ${n} Tagen überfällig` : `Overdue by ${n} days`;
    }
    return (de ? 'Frist ' : 'Due ') + this.lang.date(a.acknowledgement_date_deadline_date);
  }
}
