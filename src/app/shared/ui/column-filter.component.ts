import { Component, HostListener, computed, inject, input, model, signal } from '@angular/core';
import { LanguageService } from '@core/i18n/language.service';

export interface ColumnFilterOption { value: string; label: string; }

/**
 * Column-header filter trigger + popover: search box, "select all", a checkbox
 * per option, and a footer with the running count, Reset, and Select (apply).
 * The checkbox state is a draft — nothing changes until "Select" is pressed.
 */
@Component({
  selector: 'im-column-filter',
  standalone: true,
  styles: [`
    :host { position: relative; display: inline-flex; }
    .trigger {
      display: flex; align-items: center; gap: 6px; border: 0; background: none; cursor: pointer;
      font: inherit; font-size: 11px; font-weight: 700; letter-spacing: .08em; color: var(--fg-3); padding: 0;
    }
    .trigger.active { color: var(--escriba-teal-700); }
    .chevron { font-size: 9px; }

    /* position: fixed, placed via inline top/left computed from the trigger's own
       bounding rect — escapes the table entirely, so sibling <th> stacking/painting
       order and the table's own overflow:hidden can never clip or cover it. */
    .panel {
      position: fixed; z-index: 1000; width: 250px;
      background: #fff; border: 1px solid var(--border-1); border-radius: var(--radius-card);
      box-shadow: 0 12px 32px rgba(11,25,45,.16); padding: 16px; display: flex; flex-direction: column; gap: 12px;
      text-align: left;
    }
    .panel__title {
      font-size: 12px; font-weight: 700; letter-spacing: .08em; color: var(--escriba-teal-700);
      padding-bottom: 8px; border-bottom: 2px solid var(--escriba-teal); text-transform: uppercase;
    }
    .panel__search {
      font: inherit; font-size: 13px; padding: 9px 12px; border: 1px solid var(--border-2);
      border-radius: var(--radius-input);
      &:focus-visible { outline: none; border-color: var(--escriba-teal); box-shadow: var(--focus-ring); }
    }
    .panel__list { display: flex; flex-direction: column; gap: 2px; max-height: 220px; overflow-y: auto; }
    .panel__row {
      display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--fg-1);
      padding: 6px 4px; border-radius: 6px; cursor: pointer; font-weight: 400;
      &:hover { background: var(--bg-2); }
      input { accent-color: var(--escriba-teal-deep); }
    }
    .panel__row--all {
      font-weight: 600; border-bottom: 1px solid var(--border-1); border-radius: 0;
      margin-bottom: 4px; padding-bottom: 10px;
    }
    .panel__empty { margin: 0; font-size: 12px; color: var(--fg-3); padding: 6px 4px; }
    .panel__footer { display: flex; align-items: center; gap: 10px; padding-top: 8px; border-top: 1px solid var(--border-1); }
    .panel__count { font-size: 12px; color: var(--fg-3); white-space: nowrap; }
    .panel__reset {
      margin-left: auto; border: 1px solid var(--border-2); background: #fff; color: var(--fg-2); cursor: pointer;
      font: inherit; font-size: 12px; font-weight: 600; padding: 7px 12px; border-radius: var(--radius-pill);
    }
    .panel__apply {
      border: 0; background: var(--escriba-teal); color: var(--navy-900); cursor: pointer;
      font: inherit; font-size: 12px; font-weight: 600; padding: 7px 14px; border-radius: var(--radius-pill);
    }
  `],
  template: `
    <button type="button" class="trigger" [class.active]="selected().length" (click)="toggle($event)">
      <ng-content></ng-content>
      <span class="chevron">▾</span>
    </button>

    @if (open()) {
      <div class="panel" [style.top.px]="panelTop()" [style.left.px]="panelLeft()" (click)="$event.stopPropagation()">
        <div class="panel__title">{{ title() }}</div>
        <input class="panel__search" type="text" [value]="query()"
               (input)="query.set($any($event.target).value)"
               [placeholder]="lang.isGerman() ? 'Suchen oder auswählen…' : 'Search or select…'">

        <div class="panel__list">
          <label class="panel__row panel__row--all">
            <input type="checkbox" [checked]="allChecked()" (change)="toggleAll()">
            {{ lang.isGerman() ? 'Alle auswählen' : 'Select All' }}
          </label>
          @for (o of filteredOptions(); track o.value) {
            <label class="panel__row">
              <input type="checkbox" [checked]="draft().includes(o.value)" (change)="toggleOne(o.value)">
              {{ o.label }}
            </label>
          } @empty {
            <p class="panel__empty">{{ lang.isGerman() ? 'Keine Treffer' : 'No matches' }}</p>
          }
        </div>

        <div class="panel__footer">
          <span class="panel__count">{{ draft().length }} / {{ options().length }}</span>
          <button type="button" class="panel__reset" (click)="reset()">
            {{ lang.isGerman() ? 'Filter zurücksetzen' : 'Reset Filter' }}
          </button>
          <button type="button" class="panel__apply" (click)="apply()">
            {{ lang.isGerman() ? 'Auswählen' : 'Select' }}
          </button>
        </div>
      </div>
    }
  `
})
export class ColumnFilterComponent {
  readonly lang = inject(LanguageService);

  readonly title = input.required<string>();
  readonly options = input.required<ColumnFilterOption[]>();
  /** Two-way. Empty array means "no filter" — every row matches. */
  readonly selected = model<string[]>([]);

  readonly open = signal(false);
  readonly query = signal('');
  readonly draft = signal<string[]>([]);
  readonly panelTop = signal(0);
  readonly panelLeft = signal(0);

  readonly filteredOptions = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.options().filter((o) => !q || o.label.toLowerCase().includes(q));
  });
  readonly allChecked = computed(() =>
    this.options().length > 0 && this.draft().length === this.options().length);

  toggle(event: Event): void {
    event.stopPropagation();
    if (this.open()) { this.open.set(false); return; }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.panelTop.set(rect.bottom + 8);
    this.panelLeft.set(Math.min(rect.left, window.innerWidth - 266));
    this.draft.set([...this.selected()]);
    this.query.set('');
    this.open.set(true);
  }

  toggleOne(value: string): void {
    this.draft.update((d) => d.includes(value) ? d.filter((v) => v !== value) : [...d, value]);
  }

  toggleAll(): void {
    this.draft.set(this.allChecked() ? [] : this.options().map((o) => o.value));
  }

  reset(): void { this.draft.set([]); }

  apply(): void {
    this.selected.set(this.draft());
    this.open.set(false);
  }

  /** Click anywhere outside — panel clicks are stopped before they reach here. */
  @HostListener('document:click')
  onDocumentClick(): void { this.open.set(false); }
}
