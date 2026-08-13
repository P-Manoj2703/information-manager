import { Component, computed, inject, input } from '@angular/core';
import { Completion } from '@core/rollup';
import { LanguageService } from '@core/i18n/language.service';

@Component({
  selector: 'im-completion-bar',
  standalone: true,
  styles: [`
    .track { display: flex; height: 10px; border-radius: var(--radius-pill); overflow: hidden; background: var(--bg-3); }
    .done { background: var(--escriba-teal); }
    .pending { background: var(--escriba-blue); }
    .overdue { background: var(--danger); }
    .legend { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 10px; font-size: 12px; color: var(--fg-2); }
    .legend span { display: inline-flex; align-items: center; gap: 7px; }
    .swatch { width: 8px; height: 8px; border-radius: var(--radius-pill); }
  `],
  template: `
    <div class="track" role="img" [attr.aria-label]="aria()">
      <div class="done" [style.width.%]="pct('done')"></div>
      <div class="pending" [style.width.%]="pct('pending')"></div>
      <div class="overdue" [style.width.%]="pct('overdue')"></div>
    </div>
    @if (showLegend()) {
      <div class="legend">
        <span><i class="swatch done"></i>{{ lang.isGerman() ? 'Erledigt' : 'Done' }} {{ data().done }}</span>
        <span><i class="swatch pending"></i>{{ lang.isGerman() ? 'Ausstehend' : 'Pending' }} {{ data().pending }}</span>
        <span><i class="swatch overdue"></i>{{ lang.isGerman() ? 'Überfällig' : 'Overdue' }} {{ data().overdue }}</span>
      </div>
    }
  `
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
