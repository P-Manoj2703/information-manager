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
  templateUrl: './column-filter.component.html',
  styleUrl: './column-filter.component.scss'
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
