import { Component, ElementRef, HostListener, forwardRef, inject, input, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Closed-by-default combobox with a "Select all" / "Deselect all" header,
 * matching ECAP's own multi-select picklist widget (not a native multi
 * <select> listbox, which shows every option open at once).
 */
@Component({
  selector: 'im-multi-select-dropdown',
  standalone: true,
  providers: [{
    provide: NG_VALUE_ACCESSOR,
    useExisting: forwardRef(() => MultiSelectDropdownComponent),
    multi: true
  }],
  styles: [`
    :host { position: relative; display: block; }
    .trigger {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      font: inherit; font-size: 14px; padding: 10px 12px; cursor: pointer;
      border: 1px solid var(--border-1); border-radius: var(--radius-input); background: #fff;
      &:focus-visible, &.open { outline: none; box-shadow: var(--focus-ring); border-color: var(--escriba-teal); }
    }
    .trigger__text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg-1); }
    .trigger__text.placeholder { color: var(--fg-3); font-weight: 400; }
    .caret { flex: 0 0 auto; opacity: .5; font-size: 11px; }
    .panel {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20;
      background: #fff; border: 1px solid var(--border-1); border-radius: var(--radius-input);
      box-shadow: 0 8px 24px rgba(0,0,0,.12); overflow: hidden;
    }
    .row {
      display: flex; align-items: center; gap: 10px; padding: 10px 14px; font-size: 14px;
      cursor: pointer; background: none; border: 0; width: 100%; text-align: left; font: inherit; color: var(--fg-1);
      &:hover { background: var(--bg-mint); }
    }
    .row--bulk { font-weight: 600; }
    .divider { border-bottom: 1px solid var(--border-1); }
    .mark { flex: 0 0 14px; font-size: 13px; color: var(--escriba-teal-700); }
  `],
  template: `
    <button type="button" class="trigger" [class.open]="open()" (click)="toggleOpen()">
      <span class="trigger__text" [class.placeholder]="!value().length">{{ closedLabel() }}</span>
      <span class="caret">▾</span>
    </button>
    @if (open()) {
      <div class="panel" role="listbox">
        <button type="button" class="row row--bulk" (click)="selectAll()">
          <span class="mark">✓</span> Select all
        </button>
        <button type="button" class="row row--bulk divider" (click)="deselectAll()">
          <span class="mark">✕</span> Deselect all
        </button>
        @for (o of options(); track o) {
          <button type="button" class="row" role="option" [attr.aria-selected]="isSelected(o)" (click)="toggle(o)">
            <span class="mark">{{ isSelected(o) ? '✓' : '' }}</span> {{ o }}
          </button>
        }
      </div>
    }
  `
})
export class MultiSelectDropdownComponent implements ControlValueAccessor {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly options = input.required<string[]>();
  readonly placeholder = input('Select values');

  readonly open = signal(false);
  readonly value = signal<string[]>([]);

  private onChange: (value: string[]) => void = () => {};
  private onTouched: () => void = () => {};

  closedLabel(): string {
    return this.value().length ? this.value().join(', ') : this.placeholder();
  }

  isSelected(option: string): boolean {
    return this.value().includes(option);
  }

  toggleOpen(): void {
    this.open.update((o) => !o);
    if (!this.open()) this.onTouched();
  }

  toggle(option: string): void {
    const next = this.isSelected(option)
      ? this.value().filter((v) => v !== option)
      : [...this.value(), option];
    this.value.set(next);
    this.onChange(next);
  }

  selectAll(): void {
    this.value.set([...this.options()]);
    this.onChange(this.value());
  }

  deselectAll(): void {
    this.value.set([]);
    this.onChange([]);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.elementRef.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
      this.onTouched();
    }
  }

  writeValue(value: string[] | null): void {
    this.value.set(value ?? []);
  }

  registerOnChange(fn: (value: string[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
}
