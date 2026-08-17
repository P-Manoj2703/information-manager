import { Component, computed, inject, input } from '@angular/core';
import { Completion } from '@core/rollup';
import { LanguageService } from '@core/i18n/language.service';

@Component({
  selector: 'im-completion-bar',
  standalone: true,
  templateUrl: './completion-bar.component.html',
  styleUrl: './completion-bar.component.scss'
})
export class CompletionBarComponent {
  readonly lang = inject(LanguageService);
  readonly data = input.required<Completion>();
  readonly showLegend = input(true);
  readonly aria = computed(() => `${this.data().pct}% done`);
  pct(key: 'done' | 'pending' | 'overdue'): number {
    const d = this.data();
    return d.total ? (d[key] / d.total) * 100 : 0;
  }
}
