import { Component, computed, inject, input } from '@angular/core';
import { AckStatus, FolderStatus, VersionStatus } from '@core/models';
import { LanguageService } from '@core/i18n/language.service';

type AnyStatus = AckStatus | FolderStatus | VersionStatus;
type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE: Record<string, Tone> = {
  Pending: 'info', Overdue: 'danger', Done: 'success', Obsolete: 'neutral', None: 'neutral',
  Draft: 'neutral', Active: 'success', Inactive: 'neutral'
};
const LABEL: Record<string, [string, string]> = {
  Pending: ['Offen', 'Pending'], Overdue: ['Überfällig', 'Overdue'], Done: ['Erledigt', 'Done'],
  Obsolete: ['Nicht mehr erforderlich', 'Obsolete'], None: ['Keine', 'None'],
  Draft: ['Entwurf', 'Draft'], Active: ['Aktiv', 'Active'], Inactive: ['Inaktiv', 'Inactive']
};

@Component({
  selector: 'im-status-badge',
  standalone: true,
  styles: [`
    .badge {
      display: inline-flex; align-items: center; gap: 6px; border-radius: var(--radius-pill);
      padding: 3px 10px; font-size: 12px; font-weight: 600; white-space: nowrap;
    }
    .dot { width: 6px; height: 6px; border-radius: var(--radius-pill); background: currentColor; }
    .neutral { background: var(--bg-3); color: var(--fg-2); }
    .info    { background: #e7f0f7; color: var(--escriba-blue); }
    .success { background: var(--bg-mint); color: var(--escriba-teal-700); }
    .warning { background: #fdf6ec; color: var(--warning); }
    .danger  { background: #fdf0f0; color: var(--danger); }
  `],
  template: `
    <span class="badge" [class]="tone()">
      @if (dot()) { <span class="dot"></span> }
      {{ label() }}
    </span>
  `
})
export class StatusBadgeComponent {
  private readonly lang = inject(LanguageService);
  readonly status = input.required<AnyStatus>();
  readonly dot = input(true);
  readonly tone = computed(() => TONE[this.status()] ?? 'neutral');
  readonly label = computed(() => LABEL[this.status()][this.lang.isGerman() ? 0 : 1]);
}
