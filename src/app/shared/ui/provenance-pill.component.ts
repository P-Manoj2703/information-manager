import { Component, computed, inject, input } from '@angular/core';
import { Provenance } from '@core/models';
import { LanguageService } from '@core/i18n/language.service';

const LABEL: Record<Provenance, [string, string]> = {
  direct: ['DIREKT', 'DIRECT'],
  team: ['ÜBER TEAM', 'VIA TEAM'],
  hierarchy: ['ÜBER HIERARCHIE', 'VIA HIERARCHY']
};

/** Makes silent hierarchy expansion visible (brief §10.6). */
@Component({
  selector: 'im-provenance-pill',
  standalone: true,
  styles: [`
    span {
      font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
      border-radius: var(--radius-pill); padding: 3px 9px; white-space: nowrap;
    }
    .direct { background: var(--bg-mint); color: var(--escriba-teal-700); }
    .team { background: var(--bg-3); color: var(--fg-2); }
    .hierarchy { background: #fff; color: var(--fg-3); border: 1px dashed var(--border-2); }
  `],
  template: `<span [class]="kind()">{{ label() }}</span>`
})
export class ProvenancePillComponent {
  private readonly lang = inject(LanguageService);
  readonly kind = input.required<Provenance>();
  readonly label = computed(() => LABEL[this.kind()][this.lang.isGerman() ? 0 : 1]);
}
