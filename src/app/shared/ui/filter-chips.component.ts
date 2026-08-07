import { Component, input, model } from '@angular/core';

export interface Chip { id: string; label: string; }

@Component({
  selector: 'im-filter-chips',
  standalone: true,
  styles: [`
    .bar { display: flex; gap: 8px; flex-wrap: wrap; }
    button {
      border: 1px solid var(--border-1); background: #fff; color: var(--fg-2);
      padding: 7px 14px; border-radius: var(--radius-pill); font: inherit;
      font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;
    }
    button.on { background: var(--navy-900); color: #fff; border-color: transparent; }
  `],
  template: `
    <div class="bar" role="group">
      @for (c of chips(); track c.id) {
        <button type="button" [class.on]="value() === c.id"
                [attr.aria-pressed]="value() === c.id" (click)="toggle(c.id)">{{ c.label }}</button>
      }
    </div>
  `
})
export class FilterChipsComponent {
  readonly chips = input.required<Chip[]>();
  /** Two-way. Clicking the active chip clears back to 'all'. */
  readonly value = model<string>('all');
  toggle(id: string): void { this.value.set(this.value() === id ? 'all' : id); }
}
