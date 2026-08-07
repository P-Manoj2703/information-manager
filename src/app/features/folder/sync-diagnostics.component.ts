import { Component, inject, input } from '@angular/core';
import { LanguageService } from '@core/i18n/language.service';

/**
 * UC-ADM-06 — new. createMissingAcknowledgementsForFolder throws clear
 * diagnostics that today only reach the server log. Surface them.
 */
@Component({
  selector: 'im-sync-diagnostics',
  standalone: true,
  styles: [`
    .strip { display:flex; gap:0; border-top:1px solid var(--border-dark); padding-top:16px; flex-wrap:wrap; }
    .cell { flex:1; min-width:150px; padding-right:20px; display:flex; flex-direction:column; gap:5px; }
    .label { font-size:10px; font-weight:700; letter-spacing:.14em; color:var(--on-dark-4); }
    .value { font-size:20px; font-weight:300; color:#fff; }
    .value.bad { color:var(--danger); }
    .note { font-size:11px; color:var(--on-dark-3); }
  `],
  template: `
    <div class="strip">
      @for (d of cells; track d.label) {
        <div class="cell">
          <span class="label">{{ d.label }}</span>
          <span class="value" [class.bad]="!d.ok">{{ d.value }}</span>
          <span class="note">{{ d.note }}</span>
        </div>
      }
    </div>
  `
})
export class SyncDiagnosticsComponent {
  readonly lang = inject(LanguageService);
  readonly folderId = input.required<string>();
  // Replace with a GET on the folder's sync status endpoint.
  readonly cells = [
    { label: 'AKTIVE VERSION', value: 'v2.1 ✓', ok: true, note: 'seit 21.07.2026' },
    { label: 'ZIELGRUPPE', value: '128', ok: true, note: '4 Teams · 5 direkt' },
    { label: 'KENNTNISNAHMEN', value: '128', ok: true, note: '94 erledigt · 13 überfällig' },
    { label: 'LETZTE SYNCHRONISATION', value: '00:15', ok: true, note: 'heute · ohne Fehler' }
  ];
}
