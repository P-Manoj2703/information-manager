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
  styleUrl: './template-picker.component.scss',
  template: `
    <div class="sidebar__head">
      <span class="sidebar__title">{{ lang.isGerman() ? 'Verteilervorlage' : 'Distribution template' }}</span>
      <button type="button" class="plus-btn" (click)="show.set(!show())">
        <span class="plus">+</span> {{ lang.isGerman() ? 'Hinzufügen' : 'Add' }}
      </button>
    </div>
    <p class="sidebar__note">{{ lang.isGerman()
      ? 'Kopiert Mitglieder einmalig in diesen Ordner'
      : 'Copies members into this folder once' }}</p>

    @if (show()) {
      <div class="picker">
        <input type="text" class="lookup__input" [value]="query()"
               (input)="query.set($any($event.target).value)"
               [placeholder]="lang.isGerman() ? 'Vorlage suchen…' : 'Search templates…'">
        @if (loading()) {
          <span class="lookup__empty">{{ lang.isGerman() ? 'Vorlagen werden geladen…' : 'Loading templates…' }}</span>
        }
        <div class="add">
          @for (t of options(); track t.id) {
            <button type="button" (click)="pick(t.id)">{{ t.name }}</button>
          } @empty {
            @if (!loading()) {
              <span class="lookup__empty">{{ lang.isGerman() ? 'Keine Vorlagen gefunden' : 'No templates found' }}</span>
            }
          }
        </div>
      </div>
    }

    @if (appliedNames().length) {
      <div class="sidebar__chips">
        @for (name of appliedNames(); track name) {
          <span class="chip">{{ name }}</span>
        }
      </div>
    }
  `
})
export class TemplatePickerComponent {
  readonly lang = inject(LanguageService);

  readonly templates = input.required<DistributionTemplateOption[]>();
  readonly appliedIds = input<string[]>([]);
  readonly loading = input(false);
  readonly apply = output<string>();

  readonly show = signal(false);
  readonly query = signal('');

  readonly appliedNames = computed(() => {
    const templates = this.templates();
    return this.appliedIds()
      .map((id) => templates.find((t) => t.id === id)?.name)
      .filter((name): name is string => !!name);
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
