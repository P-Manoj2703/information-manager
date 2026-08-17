import { Component, input, model } from '@angular/core';

export interface Chip { id: string; label: string; }

@Component({
  selector: 'im-filter-chips',
  standalone: true,
  templateUrl: './filter-chips.component.html',
  styleUrl: './filter-chips.component.scss'
})
export class FilterChipsComponent {
  readonly chips = input.required<Chip[]>();
  /** Two-way. Clicking the active chip clears back to 'all'. */
  readonly value = model<string>('all');
  toggle(id: string): void { this.value.set(this.value() === id ? 'all' : id); }
}
