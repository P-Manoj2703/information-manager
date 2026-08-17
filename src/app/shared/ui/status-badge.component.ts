import { Component, computed, inject, input } from '@angular/core';
import { AckStatus, FolderStatus, VersionStatus } from '@core/models';
import { LanguageService } from '@core/i18n/language.service';

type AnyStatus = AckStatus | FolderStatus | VersionStatus;
type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE: Record<string, Tone> = {
  Pending: 'success', Overdue: 'danger', Done: 'success', Obsolete: 'neutral', None: 'neutral',
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
  templateUrl: './status-badge.component.html',
  styleUrl: './status-badge.component.scss'
})
export class StatusBadgeComponent {
  private readonly lang = inject(LanguageService);
  readonly status = input.required<AnyStatus>();
  readonly dot = input(true);
  readonly tone = computed(() => TONE[this.status()] ?? 'neutral');
  // Falls back to the raw value (or an em dash) instead of throwing when ECAP returns a
  // status this map doesn't know — e.g. a record whose status field is blank/unset.
  readonly label = computed(() => LABEL[this.status()]?.[this.lang.isGerman() ? 0 : 1] ?? this.status() ?? '—');
}
