import { Pipe, PipeTransform, inject } from '@angular/core';
import { DictKey } from './dictionary';
import { LanguageService } from './language.service';

@Pipe({ name: 't', standalone: true, pure: false })
export class TPipe implements PipeTransform {
  private readonly lang = inject(LanguageService);
  transform(key: DictKey): string { return this.lang.t(key); }
}
