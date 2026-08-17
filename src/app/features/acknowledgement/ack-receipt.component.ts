import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LanguageService } from '@core/i18n/language.service';

/** UC-REC-04 receipt — the artefact the recipient keeps for audits. */
@Component({
  selector: 'im-ack-receipt',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './ack-receipt.component.html',
  styleUrl: './ack-receipt.component.scss'
})
export class AckReceiptComponent {
  readonly lang = inject(LanguageService);
  readonly id = input.required<string>();
  readonly now = new Date().toLocaleString('de-DE');
}
