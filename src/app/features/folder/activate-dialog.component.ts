import { Component, inject, input, signal } from '@angular/core';
import { DataPort } from '@core/services/data.port';
import { LanguageService } from '@core/i18n/language.service';

/**
 * UC-IP-04 / UC-IP-05. Publishing is a blast-radius action: state N before the
 * click, and warn that people who confirmed the previous version are re-asked.
 */
@Component({
  selector: 'im-activate-dialog',
  standalone: true,
  styles: [`
    .card { background:#fff; border:1px solid var(--border-1); border-radius:var(--radius-card);
            padding:28px 32px; max-width:640px; display:flex; flex-direction:column; gap:18px; }
    h2 { margin:0; font-size:22px; font-weight:300; }
    p { margin:0; font-size:14px; line-height:1.7; color:var(--fg-2); }
    .warn { background:#fdf6ec; border:1px solid #f6e0c0; border-radius:var(--radius-input);
            padding:14px 16px; font-size:13px; color:#8a5a20; line-height:1.6; }
    .primary { align-self:flex-end; border:0; cursor:pointer; font:inherit; font-size:15px; font-weight:600;
               background:var(--escriba-teal); color:var(--navy-900); padding:14px 24px; border-radius:var(--radius-pill); }
    .receipt { background:var(--bg-mint); border-radius:var(--radius-input); padding:16px 18px;
               color:var(--escriba-teal-700); font-size:14px; }
  `],
  template: `
    <section class="card">
      @if (result(); as r) {
        <h2>{{ lang.isGerman() ? 'Veröffentlicht' : 'Published' }}</h2>
        <p class="receipt">
          {{ r.acknowledgementsCreated }}
          {{ lang.isGerman() ? 'Kenntnisnahmen angelegt und E-Mails versendet.' : 'acknowledgements created and emails sent.' }}
        </p>
      } @else {
        <h2>{{ lang.isGerman() ? 'Version aktivieren?' : 'Activate version?' }}</h2>
        <p>
          {{ lang.isGerman()
            ? 'Die Aktivierung benachrichtigt ' + teamCount() + ' Organisationseinheit(en) und ' + userCount() + ' Benutzer — es werden ' + userCount() + ' Kenntnisnahmen angelegt und ebenso viele E-Mails versendet. Die Empfänger haben ' + deadlineDays() + ' Tage Zeit.'
            : 'Activating notifies ' + teamCount() + ' organisational unit(s) and ' + userCount() + ' users — ' + userCount() + ' acknowledgements will be created and as many emails sent. Recipients have ' + deadlineDays() + ' days.' }}
        </p>
        @if (supersedes()) {
          <p class="warn">
            {{ lang.isGerman()
              ? 'Version ' + supersedes() + ' wird deaktiviert, ihre Kenntnisnahmen werden obsolet, und alle Empfänger werden erneut gefragt — auch die, die bereits bestätigt haben.'
              : 'Version ' + supersedes() + ' is deactivated, its acknowledgements become obsolete, and every recipient is asked again — including those who already confirmed.' }}
          </p>
        }
        <button class="primary" [disabled]="busy()" (click)="activate()">
          {{ lang.isGerman() ? 'Aktivieren und benachrichtigen' : 'Activate and notify' }}
        </button>
      }
    </section>
  `
})
export class ActivateDialogComponent {
  private readonly data = inject(DataPort);
  readonly lang = inject(LanguageService);

  readonly folderId = input.required<string>();
  readonly versionId = input<string>('');
  readonly teamCount = input.required<number>();
  readonly userCount = input.required<number>();
  readonly deadlineDays = input.required<number>();
  readonly supersedes = input<string | null>(null);

  readonly busy = signal(false);
  readonly result = signal<{ acknowledgementsCreated: number } | null>(null);

  activate(): void {
    this.busy.set(true);
    this.data.activateVersion(this.versionId()).subscribe({
      next: (r) => { this.result.set(r); this.busy.set(false); },
      error: () => this.busy.set(false)
    });
  }
}
