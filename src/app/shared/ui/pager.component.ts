import { Component, computed, inject, input, model } from '@angular/core';
import { LanguageService } from '@core/i18n/language.service';

/**
 * Client-side pagination control — reused across every list/table page in the app so "rows per
 * page" behaves identically everywhere. Purely presentational: the page just slices its own
 * already-filtered rows using [page]/[pageSize]; this component doesn't know what it's paging.
 */
@Component({
  selector: 'im-pager',
  standalone: true,
  styles: [`
    .pager { display:flex; align-items:center; gap:16px; margin-top:16px; font-size:13px; color:var(--fg-2); flex-wrap:wrap; }
    .pager .spacer { margin-left:auto; }
    .pager select { font:inherit; font-size:13px; padding:6px 10px; border:1px solid var(--border-1);
                     border-radius:var(--radius-input); }
    .pager button { border:1px solid var(--border-2); background:#fff; color:var(--fg-2); cursor:pointer;
                     font:inherit; font-size:13px; font-weight:600; padding:6px 14px; border-radius:var(--radius-pill);
                     &:disabled { opacity:.4; cursor:not-allowed; } }
  `],
  template: `
    <div class="pager">
      <span>{{ lang.isGerman() ? 'Zeilen pro Seite' : 'Rows per page' }}:</span>
      <select [value]="pageSize()" (change)="onPageSizeChange($any($event.target).value)">
        @for (n of pageSizeOptions(); track n) { <option [value]="n">{{ n }}</option> }
      </select>
      <span class="spacer"></span>
      <span>{{ rangeLabel() }}</span>
      <button type="button" [disabled]="page() === 1" (click)="page.set(page() - 1)">
        {{ lang.isGerman() ? 'Zurück' : 'Previous' }}
      </button>
      <button type="button" [disabled]="page() >= totalPages()" (click)="page.set(page() + 1)">
        {{ lang.isGerman() ? 'Weiter' : 'Next' }}
      </button>
    </div>
  `
})
export class PagerComponent {
  readonly lang = inject(LanguageService);

  readonly total = input.required<number>();
  readonly pageSizeOptions = input<number[]>([10, 20, 50, 100]);

  /** Two-way. */
  readonly page = model(1);
  readonly pageSize = model(10);

  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));

  onPageSizeChange(value: string): void {
    this.pageSize.set(+value);
    this.page.set(1);
  }

  rangeLabel(): string {
    const total = this.total();
    if (!total) return '0';
    const start = (this.page() - 1) * this.pageSize() + 1;
    const end = Math.min(total, this.page() * this.pageSize());
    return `${start}–${end} / ${total}`;
  }
}
