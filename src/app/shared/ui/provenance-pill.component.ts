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
  templateUrl: './provenance-pill.component.html',
  styleUrl: './provenance-pill.component.scss'
})
export class ProvenancePillComponent {
  private readonly lang = inject(LanguageService);
  readonly kind = input.required<Provenance>();
  readonly label = computed(() => LABEL[this.kind()][this.lang.isGerman() ? 0 : 1]);
}
