import { Injectable, computed, signal } from '@angular/core';
import { DICT, DictKey, Lang } from './dictionary';

const STORAGE_KEY = 'im.lang';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly _lang = signal<Lang>((localStorage.getItem(STORAGE_KEY) as Lang) ?? 'de');
  readonly lang = this._lang.asReadonly();
  readonly isGerman = computed(() => this._lang() === 'de');

  set(lang: Lang): void {
    this._lang.set(lang);
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
  }

  t(key: DictKey): string { return DICT[key][this._lang() === 'de' ? 0 : 1]; }

  /** ISO dates in tables, German long form in prose. */
  date(iso: string): string {
    return this._lang() === 'de'
      ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : iso;
  }
}
