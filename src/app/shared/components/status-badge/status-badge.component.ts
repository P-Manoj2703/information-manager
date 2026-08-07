import { Component, computed, input } from '@angular/core';
import { AcknowledgmentStatus, FolderStatus, VersionStatus } from '@core/models';
import { TranslatePipe } from '@core/i18n/translate.pipe';
import { TranslationKey } from '@core/i18n/de';

type AnyStatus = AcknowledgmentStatus | FolderStatus | VersionStatus;

const TONE: Record<AnyStatus, string> = {
  Pending: 'info', Overdue: 'danger', Done: 'success', Obsolete: 'neutral', None: 'neutral',
  Draft: 'neutral', Active: 'success', Inactive: 'neutral'
};

@Component({
  selector: 'im-status-badge',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <span class="badge" [class]="'badge badge--' + tone()">
      @if (dot()) { <span class="badge__dot"></span> }
      {{ key() | t }}
    </span>
  `
})
export class StatusBadgeComponent {
  readonly status = input.required<AnyStatus>();
  readonly dot = input(true);
  readonly tone = computed(() => TONE[this.status()]);
  readonly key = computed(() => ('status.' + this.status()) as TranslationKey);
}
