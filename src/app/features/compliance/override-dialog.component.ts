import { Component, EventEmitter, Output, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Acknowledgement, AckStatus } from '@core/models';
import { DataPort } from '@core/services/data.port';
import { LanguageService } from '@core/i18n/language.service';

/**
 * UC-CMP-04 — the capability the platform grants but the form blocks.
 * A reason is mandatory and goes to the audit trail.
 */
@Component({
  selector: 'im-override-dialog',
  standalone: true,
  imports: [FormsModule],
  styles: [`
    .backdrop { position:fixed; inset:0; background:rgba(6,19,30,.55); display:grid; place-items:center;
                padding:32px; z-index:50; }
    .dialog { background:#fff; border-radius:var(--radius-card); width:100%; max-width:520px;
              padding:26px 30px 22px; display:flex; flex-direction:column; gap:16px; box-shadow:var(--shadow-lg); }
    h2 { margin:0; font-size:22px; font-weight:300; }
    .options { display:flex; gap:8px; }
    .options button { border:1px solid var(--border-1); background:#fff; color:var(--fg-2); cursor:pointer;
                      font:inherit; font-size:13px; font-weight:600; padding:7px 14px; border-radius:var(--radius-pill);
                      &.on { background:var(--navy-900); color:#fff; border-color:transparent; } }
    textarea { font:inherit; font-size:13px; padding:10px 12px; border:1px solid var(--border-1);
               border-radius:var(--radius-input); min-height:84px; resize:vertical; }
    .note { margin:0; font-size:11px; color:var(--fg-3); }
    footer { display:flex; justify-content:flex-end; gap:10px; }
    .primary { border:0; cursor:pointer; font:inherit; font-weight:600; background:var(--escriba-teal);
               color:var(--navy-900); padding:11px 20px; border-radius:var(--radius-pill);
               &:disabled { opacity:.5; cursor:not-allowed; } }
    .ghost { border:1px solid var(--border-2); background:#fff; cursor:pointer; font:inherit; font-weight:600;
             padding:11px 20px; border-radius:var(--radius-pill); }
  `],
  template: `
    <div class="backdrop" (click)="closed.emit()">
      <div class="dialog" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
        <h2>{{ lang.isGerman() ? 'Status übersteuern' : 'Override status' }}</h2>
        <div class="options">
          @for (s of options; track s) {
            <button type="button" [class.on]="status() === s" (click)="status.set(s)">{{ s }}</button>
          }
        </div>
        <label>
          <span class="eyebrow">{{ lang.t('reasonRequired') }}</span>
          <textarea [(ngModel)]="reason" name="reason"></textarea>
        </label>
        <p class="note">{{ lang.isGerman()
          ? 'Wird mit Benutzer, Zeitstempel und vorherigem Status in die Änderungshistorie geschrieben.'
          : 'Written to the audit trail with user, timestamp and previous status.' }}</p>
        <footer>
          <button type="button" class="ghost" (click)="closed.emit()">{{ lang.isGerman() ? 'Abbrechen' : 'Cancel' }}</button>
          <button type="button" class="primary" [disabled]="!reason()" (click)="save()">
            {{ lang.isGerman() ? 'Status speichern' : 'Save status' }}
          </button>
        </footer>
      </div>
    </div>
  `
})
export class OverrideDialogComponent {
  private readonly data = inject(DataPort);
  readonly lang = inject(LanguageService);
  readonly ack = input.required<Acknowledgement>();
  @Output() readonly closed = new EventEmitter<void>();

  readonly options: AckStatus[] = ['Done', 'Pending', 'Obsolete'];
  readonly status = signal<AckStatus>('Done');
  readonly reason = signal('');

  save(): void {
    this.data.overrideAckStatus(this.ack().id, this.status(), this.reason())
      .subscribe(() => this.closed.emit());
  }
}
