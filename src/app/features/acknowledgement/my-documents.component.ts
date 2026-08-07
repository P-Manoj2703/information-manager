import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DataPort } from '@core/services/data.port';
import { SessionService } from '@core/services/session.service';
import { LanguageService } from '@core/i18n/language.service';
import { Acknowledgement } from '@core/models';

/** Saved view "My Assigned Document Versions" — the only one this role gets. */
@Component({
  selector: 'im-my-documents',
  standalone: true,
  imports: [RouterLink],
  styles: [`
    .note { background: #fff; border: 1px solid var(--border-1); border-radius: var(--radius-input);
            padding: 12px 16px; font-size: 13px; color: var(--fg-2); margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; background: #fff;
            border: 1px solid var(--border-1); border-radius: var(--radius-card); overflow: hidden; }
    th { text-align: left; font-size: 11px; font-weight: 700; letter-spacing: .08em; color: var(--fg-3);
         background: var(--bg-2); padding: 12px 20px; }
    td { padding: 16px 20px; border-top: 1px solid var(--border-1); font-size: 14px; }
  `],
  template: `
    <p class="note">
      {{ lang.isGerman()
          ? 'Sie sehen ausschließlich Dokumentversionen, für die eine Kenntnisnahme für Sie vorliegt. Datei-Uploads sind für diese Rolle nicht möglich.'
          : 'You only see document versions you hold an acknowledgement for. File uploads are not available for this role.' }}
    </p>
    <table>
      <thead><tr>
        <th>{{ lang.t('documents') }}</th><th>{{ lang.t('version') }}</th><th></th>
      </tr></thead>
      <tbody>
        @for (a of rows(); track a.id) {
          <tr>
            <td>{{ a.acknowledgement_textfield_information_folder_name }}</td>
            <td class="mono">{{ a.documentversion_record }}</td>
            <td><a [routerLink]="['/tasks', a.id]">{{ lang.isGerman() ? 'PDF öffnen' : 'Open PDF' }}</a></td>
          </tr>
        }
      </tbody>
    </table>
  `
})
export class MyDocumentsComponent {
  private readonly data = inject(DataPort);
  private readonly session = inject(SessionService);
  readonly lang = inject(LanguageService);
  readonly rows = toSignal(
    this.data.acknowledgements({ userId: this.session.session().userId }),
    { initialValue: [] as Acknowledgement[] });
}
