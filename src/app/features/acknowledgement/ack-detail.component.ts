import { Component, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { DataPort } from '@core/services/data.port';
import { SessionService } from '@core/services/session.service';
import { AcknowledgementService } from '@core/services/acknowledgement.service';
import { LanguageService } from '@core/i18n/language.service';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { PdfViewerComponent } from './pdf-viewer.component';

/**
 * UC-REC-03 / UC-REC-04.
 * The status field is READ-ONLY text. The only state change is completing the
 * BPM user task — the recipient has no update right on the record.
 */
@Component({
  selector: 'im-ack-detail',
  standalone: true,
  imports: [RouterLink, StatusBadgeComponent, PdfViewerComponent],
  styleUrl: './ack-detail.component.scss',
  template: `
    @if (ack(); as a) {
      <div class="layout">
        <div class="col">
          <a class="back" routerLink="/tasks">← {{ lang.isGerman() ? 'Zurück zur Liste' : 'Back to list' }}</a>

          <article class="card message">
            <div class="message__meta">
              <im-status-badge [status]="a.acknowledgment_picklist_status" />
              <span class="mono">{{ a.documentversion_record }}</span>
            </div>
            <h1>{{ a.acknowledgement_textfield_information_folder_name }}</h1>
            <span class="eyebrow">{{ lang.t('messageFrom') }}</span>
            <!-- Hidden by the tenant form rule; restored here (brief §11.1). -->
            <div class="richtext" [innerHTML]="a.acknowledgment_richtextarea_user_information"></div>
          </article>

          <im-pdf-viewer [versionId]="a.documentversion_record" [canDownloadAll]="true" />
        </div>

        <aside class="task">
          @if (canConfirm()) {
            <span class="eyebrow eyebrow--teal">{{ lang.t('yourTask') }}</span>
            <h2>{{ lang.isGerman() ? 'Bestätigen Sie, dass Sie dieses Dokument gelesen haben.' : 'Confirm that you have read this document.' }}</h2>
            <dl>
              <div><dt>{{ lang.t('deadline') }}</dt><dd class="tabular">{{ lang.date(a.acknowledgement_date_deadline_date) }}</dd></div>
              <div><dt>{{ lang.t('status') }}</dt><dd>{{ a.acknowledgment_picklist_status }}</dd></div>
            </dl>
            <button type="button" class="confirm" [disabled]="busy()" (click)="confirm()">
              {{ lang.t('confirmButton') }}
            </button>
            <p class="note">{{ lang.t('perVersionNote') }}</p>
          } @else {
            <span class="eyebrow">{{ lang.isGerman() ? 'LESEANSICHT' : 'READING VIEW' }}</span>
            <p class="note note--dark">
              {{ lang.isGerman()
                  ? 'Für diese Version ist keine Bestätigung (mehr) erforderlich.'
                  : 'No confirmation is (still) required for this version.' }}
            </p>
          }
        </aside>
      </div>
    }
  `
})
export class AckDetailComponent {
  private readonly data = inject(DataPort);
  private readonly service = inject(AcknowledgementService);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  readonly lang = inject(LanguageService);

  /** Bound from the route via withComponentInputBinding(). */
  readonly id = input.required<string>();
  readonly busy = signal(false);

  readonly ack = toSignal(
    this.data.acknowledgements({ userId: this.session.session().userId })
      .pipe(map((list) => list.find((a) => a.id === this.id()))));

  canConfirm(): boolean {
    const s = this.ack()?.acknowledgment_picklist_status;
    return s === 'Pending' || s === 'Overdue';
  }

  confirm(): void {
    const a = this.ack();
    if (!a) return;
    this.busy.set(true);
    this.service.confirm(a).subscribe({
      next: () => this.router.navigate(['/tasks', a.id, 'receipt']),
      error: () => this.busy.set(false)
    });
  }
}
