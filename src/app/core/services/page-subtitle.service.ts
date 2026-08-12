import { Injectable, signal } from '@angular/core';

/**
 * Lets a routed page override the shell topbar's static subtitle with real, page-computed text
 * (e.g. task-list.component.ts's real open/overdue counts) — the shell itself has no access to
 * that page's own fetched data. Pages that set an override must clear it on destroy so it
 * doesn't leak into the next page's header before that page's own effects (if any) run.
 */
@Injectable({ providedIn: 'root' })
export class PageSubtitleService {
  readonly override = signal<string | null>(null);

  set(text: string): void {
    this.override.set(text);
  }

  clear(): void {
    this.override.set(null);
  }
}
