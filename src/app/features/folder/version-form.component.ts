import { Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { DataPort } from '@core/services/data.port';
import { InformationFolder } from '@core/models';
import { LanguageService } from '@core/i18n/language.service';
import { VersionUploadComponent } from './version-upload.component';
import { ActivateDialogComponent } from './activate-dialog.component';

/** UC-IP-05 — a new version on an existing folder re-asks the whole audience. */
@Component({
  selector: 'im-version-form',
  standalone: true,
  imports: [RouterLink, VersionUploadComponent, ActivateDialogComponent],
  styles: [`
    .back { display:inline-block; margin-bottom:16px; font-size:13px; color:var(--fg-3); text-decoration:none;
            &:hover { color:var(--escriba-teal-700); } }
    .warn { background:#fdf6ec; border:1px solid #f6e0c0; border-radius:var(--radius-input);
            padding:14px 18px; font-size:13px; color:#8a5a20; line-height:1.6; margin-bottom:18px; max-width:900px; }
  `],
  template: `
    <a class="back" [routerLink]="['/folders', id()]">← {{ folderName() }}</a>

    <p class="warn">
      {{ lang.isGerman()
        ? 'Beim Aktivieren wird die bisherige Version deaktiviert, ihre Kenntnisnahmen werden auf „Nicht mehr erforderlich" gesetzt und die gesamte Zielgruppe erhält neue Aufgaben mit frischer Frist — auch Personen, die bereits bestätigt haben.'
        : 'On activation the current version is deactivated, its acknowledgements are set to Obsolete, and the whole audience receives new tasks with a fresh deadline — including people who already confirmed.' }}
    </p>

    <im-version-upload [folderId]="id()" [folderName]="folderName()" (continue)="ready.set(true)" />

    @if (ready()) {
      <im-activate-dialog [folderId]="id()" [teamCount]="3" [userCount]="128" [deadlineDays]="14" supersedes="v2.1" />
    }
  `
})
export class VersionFormComponent {
  private readonly data = inject(DataPort);
  readonly lang = inject(LanguageService);
  readonly id = input.required<string>();
  readonly ready = signal(false);

  private readonly folder = toSignal<InformationFolder | null>(
    toObservable(this.id).pipe(switchMap((id) => this.data.folder(id))), { initialValue: null });
  readonly folderName = () => this.folder()?.information_folder_textfield_name ?? '';
}
