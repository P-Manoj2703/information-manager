import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LanguageService } from '@core/i18n/language.service';
import { AudienceBuilderComponent } from '@features/distribution/audience-builder.component';
import { VersionUploadComponent } from './version-upload.component';
import { ActivateDialogComponent } from './activate-dialog.component';

/**
 * UC-IP-01. Four steps, shown from the first screen: the platform hides the
 * audience subforms until the record exists, so a save is not the end.
 */
@Component({
  selector: 'im-folder-wizard',
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, AudienceBuilderComponent, VersionUploadComponent, ActivateDialogComponent],
  styleUrl: './folder-wizard.component.scss',
  template: `
    <a class="back" routerLink="/folders">← {{ lang.t('folders') }}</a>

    <ol class="rail">
      @for (s of steps; track s.n) {
        <li class="rail__step" [class.on]="step() === s.n" [class.past]="step() > s.n" (click)="step.set(s.n)">
          <span class="rail__num">{{ s.n }}</span>
          <span>{{ lang.isGerman() ? s.de : s.en }}</span>
        </li>
      }
    </ol>

    @switch (step()) {
      @case (1) {
        <form class="card" [formGroup]="form" (ngSubmit)="saveDraft()">
          <h2>{{ lang.isGerman() ? 'Metadaten' : 'Metadata' }}</h2>
          <div class="grid">
            <label>{{ lang.isGerman() ? 'Kurzname' : 'Short name' }}
              <input formControlName="information_folder_textfield_short_name">
            </label>
            <label>{{ lang.isGerman() ? 'Name' : 'Name' }} *
              <input formControlName="information_folder_textfield_name" required>
            </label>
            <label>{{ lang.isGerman() ? 'Beschreibung' : 'Description' }}
              <textarea rows="3" formControlName="information_folder_textfield_description"></textarea>
            </label>
            <label>{{ lang.isGerman() ? 'Vertraulichkeit' : 'Confidentiality' }} *
              <select formControlName="information_folder_picklist_confidentiality_level">
                <option value="Internal">Internal</option>
                <option value="Public">Public</option>
                <option value="Confidential">Confidential</option>
              </select>
            </label>
            <label>{{ lang.isGerman() ? 'Dokumentkategorie' : 'Document category' }}
              <input formControlName="information_folder_textfield_document_category">
            </label>
            <label>{{ lang.isGerman() ? 'Dokumentsprache' : 'Document language' }}
              <select multiple formControlName="information_folder_multi_select_picklist_document_language">
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </select>
            </label>
            <label>{{ lang.isGerman() ? 'Status' : 'Status' }} *
              <input value="Draft" disabled>
            </label>
            <label>{{ lang.isGerman() ? 'Verantwortliches Team' : 'Responsible team' }} *
              <input formControlName="information_folder_lookup_responsible_team" required>
            </label>
            <label>{{ lang.isGerman() ? 'Frist (Tage)' : 'Deadline (days)' }} *
              <input type="number" min="1" formControlName="information_folder_number_deadlinedays" required>
            </label>
          </div>

          <label class="rich">
            {{ lang.isGerman() ? 'Benutzerinformation' : 'User Information' }} *
            <small>{{ lang.isGerman()
              ? 'Wird auf jede Kenntnisnahme kopiert. Das ist der Text, den Empfänger lesen.'
              : 'Copied onto every acknowledgement. This is the text recipients read.' }}</small>
            <textarea rows="6" formControlName="information_folder_richtext_area_user_information"></textarea>
          </label>

          <footer>
            <p class="hint">{{ lang.isGerman()
              ? 'Speichern legt den Ordner im Status „Entwurf" an — es werden noch keine Benachrichtigungen versendet.'
              : 'Saving creates the folder in Draft — no notifications are sent yet.' }}</p>
            <button class="primary" [disabled]="form.invalid">{{ lang.isGerman() ? 'Speichern und weiter' : 'Save and continue' }}</button>
          </footer>
        </form>
      }
      @case (2) { <im-audience-builder [folderId]="folderId()" (continue)="onAudienceContinue($event)" /> }
      @case (3) {
        <im-version-upload [folderId]="folderId()" [folderName]="form.value.information_folder_textfield_name ?? ''"
                            (continue)="step.set(4)" />
      }
      @case (4) {
        <im-activate-dialog [folderId]="folderId()" [teamCount]="teamCount()" [userCount]="userCount()"
                            [supersedes]="null" [deadlineDays]="form.value.information_folder_number_deadlinedays ?? 14" />
      }
    }
  `
})
export class FolderWizardComponent {
  private readonly fb = inject(FormBuilder);
  readonly lang = inject(LanguageService);

  readonly step = signal(1);
  readonly folderId = signal('');
  readonly teamCount = signal(0);
  readonly userCount = signal(0);

  readonly steps = [
    { n: 1, de: 'Metadaten', en: 'Metadata' },
    { n: 2, de: 'Zielgruppe', en: 'Audience' },
    { n: 3, de: 'Dokumentversion', en: 'Document version' },
    { n: 4, de: 'Veröffentlichen', en: 'Publish' }
  ];

  readonly form = this.fb.nonNullable.group({
    information_folder_textfield_name: ['', Validators.required],
    information_folder_textfield_short_name: [''],
    information_folder_textfield_description: [''],
    information_folder_number_deadlinedays: [14, [Validators.required, Validators.min(1)]],
    information_folder_lookup_responsible_team: ['', Validators.required],
    information_folder_picklist_confidentiality_level: ['Internal', Validators.required],
    information_folder_textfield_document_category: [''],
    information_folder_multi_select_picklist_document_language: this.fb.nonNullable.control<string[]>(['de']),
    information_folder_richtext_area_user_information: ['', Validators.required]
  });

  saveDraft(): void {
    if (this.form.invalid) return;
    // POST /record/{informationFolder} — server stamps User Id + Primary Team Id.
    this.folderId.set('new-folder');
    this.step.set(2);
  }

  onAudienceContinue(counts: { teamCount: number; userCount: number }): void {
    this.teamCount.set(counts.teamCount);
    this.userCount.set(counts.userCount);
    this.step.set(3);
  }
}
