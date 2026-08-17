import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DataPort } from '@core/services/data.port';
import { SessionService } from '@core/services/session.service';
import { LanguageService } from '@core/i18n/language.service';
import { AppUser } from '@core/models';
import { FilterChipsComponent, Chip } from '@shared/ui/filter-chips.component';

/** UC-ADM-01. For the Information Provider every create/edit control is HIDDEN. */
@Component({
  selector: 'im-user-list',
  standalone: true,
  imports: [FilterChipsComponent],
  templateUrl: './user-list.component.html',
  styleUrl: './user-list.component.scss'
})
export class UserListComponent {
  private readonly data = inject(DataPort);
  readonly session = inject(SessionService);
  readonly lang = inject(LanguageService);
  readonly filter = signal('active');
  private readonly all = toSignal(this.data.users(), { initialValue: [] as AppUser[] });

  readonly chips = computed<Chip[]>(() => [
    { id: 'active', label: this.lang.t('active') },
    { id: 'inactive', label: this.lang.t('inactive') },
    { id: 'all', label: this.lang.isGerman() ? 'Alle' : 'All' }
  ]);
  readonly rows = computed(() => this.all().filter((u) =>
    this.filter() === 'all' ? true : this.filter() === 'active' ? u.active : !u.active));
}
