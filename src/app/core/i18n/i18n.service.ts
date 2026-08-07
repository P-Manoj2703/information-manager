import { Injectable, computed, inject } from '@angular/core';
import { SessionService } from '@core/services/session.service';
import { DE, TranslationKey } from './de';
import { EN } from './en';

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly session = inject(SessionService);
  private readonly dict = computed(() => (this.session.lang() === 'de' ? DE : EN));

  t(key: TranslationKey, params?: Record<string, string | number>): string {
    let out: string = this.dict()[key];
    if (params) {
      for (const [k, v] of Object.entries(params)) out = out.split(`{${k}}`).join(String(v));
    }
    return out;
  }
}
