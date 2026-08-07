import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LanguageService } from '@core/i18n/language.service';

/** UC-REC-04 receipt — the artefact the recipient keeps for audits. */
@Component({
  selector: 'im-ack-receipt',
  standalone: true,
  imports: [RouterLink],
  styles: [`
    .receipt {
      max-width: 560px; margin: 40px auto; background: #fff; border: 1px solid var(--border-1);
      border-radius: var(--radius-card); padding: 44px; text-align: center;
      display: flex; flex-direction: column; align-items: center; gap: 18px; box-shadow: var(--shadow-xs);
    }
    .tick { width: 56px; height: 56px; border-radius: var(--radius-pill); background: var(--bg-mint);
            color: var(--escriba-teal-deep); display: grid; place-items: center; font-size: 26px; }
    h1 { margin: 0; font-size: 26px; font-weight: 300; }
    dl { width: 100%; margin: 0; background: var(--bg-2); border: 1px solid var(--border-1);
         border-radius: var(--radius-input); padding: 18px 20px; text-align: left;
         display: flex; flex-direction: column; gap: 10px; }
    dl > div { display: flex; justify-content: space-between; gap: 16px; font-size: 13px; }
    dt { color: var(--fg-3); } dd { margin: 0; font-weight: 600; }
  `],
  template: `
    <section class="receipt">
      <span class="tick" aria-hidden="true">✓</span>
      <h1>{{ lang.isGerman() ? 'Kenntnisnahme bestätigt' : 'Acknowledgement confirmed' }}</h1>
      <dl>
        <div><dt>{{ lang.t('version') }}</dt><dd class="mono">{{ id() }}</dd></div>
        <div><dt>{{ lang.isGerman() ? 'Zeitpunkt' : 'Timestamp' }}</dt><dd class="tabular">{{ now }}</dd></div>
      </dl>
      <a routerLink="/tasks">{{ lang.isGerman() ? 'Zurück zur Liste' : 'Back to list' }}</a>
    </section>
  `
})
export class AckReceiptComponent {
  readonly lang = inject(LanguageService);
  readonly id = input.required<string>();
  readonly now = new Date().toLocaleString('de-DE');
}
