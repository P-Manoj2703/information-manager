import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DataPort } from '@core/services/data.port';
import { LanguageService } from '@core/i18n/language.service';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { Acknowledgement } from '@core/models';

/** Read-only record view for a single acknowledgement, reached from the chase table. */
@Component({
  selector: 'im-ack-record-detail',
  standalone: true,
  imports: [RouterLink, StatusBadgeComponent],
  styleUrl: './ack-record-detail.component.scss',
  template: `
    <a class="back" routerLink="/acknowledgements">← {{ lang.t('acknowledgements') }}</a>

    @if (ack(); as a) {
      <section class="card">
        <header class="head">
          <im-status-badge [status]="a.acknowledgment_picklist_status" />
          <h1>{{ a.acknowledgment_textfield_employee }}</h1>
        </header>

        <div class="grid">
          <div class="field">
            <span class="label">{{ lang.isGerman() ? 'Person' : 'Person' }}</span>
            <span>{{ a.acknowledgment_textfield_employee }}</span>
          </div>
          <div class="field">
            <span class="label">{{ lang.isGerman() ? 'E-Mail' : 'Email' }}</span>
            <span>{{ a.acknowledgment_email_address_email }}</span>
          </div>
          <div class="field">
            <span class="label">{{ lang.t('folders') }}</span>
            <a [routerLink]="['/folders', a.acknowledgement_lookup_information_folder]">
              {{ a.acknowledgement_textfield_information_folder_name }}
            </a>
          </div>
          <div class="field">
            <span class="label">{{ lang.t('version') }}</span>
            <span class="mono">{{ a.documentversion_record }}</span>
          </div>
          <div class="field">
            <span class="label">{{ lang.t('deadline') }}</span>
            <span>{{ lang.date(a.acknowledgement_date_deadline_date) }}</span>
          </div>
          <div class="field">
            <span class="label">{{ lang.t('status') }}</span>
            <im-status-badge [status]="a.acknowledgment_picklist_status" [dot]="false" />
          </div>
          <div class="field wide">
            <span class="label">{{ lang.t('messageFrom') }}</span>
            <div class="richtext" [innerHTML]="a.acknowledgment_richtextarea_user_information"></div>
          </div>
        </div>
      </section>
    } @else {
      <p class="missing">{{ lang.isGerman() ? 'Kenntnisnahme nicht gefunden.' : 'Acknowledgement not found.' }}</p>
    }
  `
})
export class AckRecordDetailComponent {
  private readonly data = inject(DataPort);
  readonly lang = inject(LanguageService);

  readonly id = input.required<string>();

  private readonly all = toSignal(this.data.acknowledgements({}), { initialValue: [] as Acknowledgement[] });
  readonly ack = computed(() => this.all().find((a) => a.id === this.id()));
}
