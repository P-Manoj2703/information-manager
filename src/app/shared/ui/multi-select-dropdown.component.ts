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
  templateUrl: './multi-select-dropdown.component.html',
  styleUrl: './multi-select-dropdown.component.scss'
})
export class MultiSelectDropdownComponent implements ControlValueAccessor {
  private readonly elementRef = inject(ElementRef<HTMLElement>);

  readonly options = input.required<string[]>();
  readonly placeholder = input('Select values');

  readonly open = signal(false);
  readonly value = signal<string[]>([]);
  readonly disabled = signal(false);

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

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
    if (isDisabled) this.open.set(false);
  }
}
