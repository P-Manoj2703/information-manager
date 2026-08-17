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
  templateUrl: './pager.component.html',
  styleUrl: './pager.component.scss'
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
