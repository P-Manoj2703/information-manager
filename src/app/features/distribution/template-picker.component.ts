import { Component, computed, inject, input, output, signal } from '@angular/core';
import { LanguageService } from '@core/i18n/language.service';

/** One row of the real Distribution_Lists object (45aed8d75ae542179befff2799f36532). */
export interface DistributionTemplateOption { id: string; name: string; }

/**
 * Full-height sidebar next to the audience panels. Presentational only — the parent
 * (AudienceBuilderComponent) owns what "applying" a template actually does (posting
 * to ECAP's DistributionListAttachController); this component just picks one and
 * emits its id.
 */
@Component({
  selector: 'im-template-picker',
  standalone: true,
  templateUrl: './template-picker.component.html',
  styleUrl: './template-picker.component.scss'
})
export class TemplatePickerComponent {
  readonly lang = inject(LanguageService);

  readonly templates = input.required<DistributionTemplateOption[]>();
  readonly appliedIds = input<string[]>([]);
  readonly loading = input(false);
  readonly apply = output<string>();
  /** Undoes a template's real effect — see AudienceBuilderComponent.removeTemplate for what "undo" actually means. */
  readonly remove = output<string>();

  readonly show = signal(false);
  readonly query = signal('');

  readonly appliedTemplates = computed(() => {
    const templates = this.templates();
    return this.appliedIds()
      .map((id) => templates.find((t) => t.id === id))
      .filter((t): t is DistributionTemplateOption => !!t);
  });

  /** Multi-select: already-applied templates drop out of the pickable list, same as teams/users. */
  readonly options = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.templates()
      .filter((t) => !this.appliedIds().includes(t.id))
      .filter((t) => !q || t.name.toLowerCase().includes(q));
  });

  pick(id: string): void {
    this.apply.emit(id);
    this.query.set('');
  }
}
