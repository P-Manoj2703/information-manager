import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { combineLatest, switchMap } from 'rxjs';
import { DataPort } from '@core/services/data.port';
import { LanguageService } from '@core/i18n/language.service';
import { SessionService } from '@core/services/session.service';
import { completion } from '@core/rollup';
import { canDelete, isFieldEditable } from '@core/folder-rules';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { CompletionBarComponent } from '@shared/ui/completion-bar.component';
import { SyncDiagnosticsComponent } from './sync-diagnostics.component';
import { VersionTimelineComponent } from './version-timeline.component';

/** UC-IP-07 / UC-ADM-06. Active = frozen; the diagnostic strip explains silence. */
@Component({
  selector: 'im-folder-detail',
  standalone: true,
  imports: [
    RouterLink, ReactiveFormsModule, StatusBadgeComponent, CompletionBarComponent,
    SyncDiagnosticsComponent, VersionTimelineComponent
  ],
  styleUrl: './folder-detail.component.scss',
  template: `
    <a class="back" routerLink="/folders">← {{ lang.t('folders') }}</a>

    @if (folder(); as f) {
      <header class="hero">
        <div class="hero__top">
          <div>
            <im-status-badge [status]="f.information_folder_picklist_status" />
            <h1>{{ f.information_folder_textfield_name }}</h1>
          </div>
          <div class="hero__actions">
            @if (canEditPublished()) {
              <button type="button" class="ghost" (click)="startEdit(f)">{{ lang.t('editPublished') }}</button>
            }
            <a class="primary" [routerLink]="['/folders', f.id, 'versions', 'new']">{{ lang.t('newVersion') }}</a>
          </div>
        </div>
        <im-sync-diagnostics [folderId]="f.id" />
      </header>

      @if (frozen()) {
        <p class="frozen">
          {{ lang.isGerman()
            ? 'Dieser Ordner ist veröffentlicht und gesperrt. Nur Frist und Beschreibung sind bearbeitbar — alle weiteren Änderungen erfordern Deaktivieren → Bearbeiten → Aktivieren.'
            : 'This folder is published and frozen. Only the deadline and description are editable — any further change requires deactivate → edit → activate.' }}
        </p>
      }

      @if (editing()) {
        <form class="card edit-card" [formGroup]="editForm" (ngSubmit)="saveMetadata(f.id)">
          <h2>{{ lang.isGerman() ? 'Metadaten bearbeiten' : 'Edit metadata' }}</h2>
          <div class="grid">
            <label>{{ lang.isGerman() ? 'Kurzname' : 'Short name' }}
              <input [value]="f.information_folder_textfield_short_name ?? ''" disabled>
            </label>
            <label>{{ lang.isGerman() ? 'Name' : 'Name' }}
              <input [value]="f.information_folder_textfield_name" disabled>
            </label>
            <label>{{ lang.isGerman() ? 'Frist (Tage)' : 'Deadline (days)' }} *
              <input type="number" min="1" formControlName="information_folder_number_deadlinedays">
            </label>
            <label>{{ lang.isGerman() ? 'Vertraulichkeit' : 'Confidentiality' }}
              <input [value]="f.information_folder_picklist_confidentiality_level" disabled>
            </label>
            <label>{{ lang.isGerman() ? 'Dokumentkategorie' : 'Document category' }}
              <input [value]="f.information_folder_textfield_document_category ?? ''" disabled>
            </label>
            <label>{{ lang.isGerman() ? 'Status' : 'Status' }}
              <input [value]="f.information_folder_picklist_status" disabled>
            </label>
            <label>{{ lang.isGerman() ? 'Verantwortliches Team' : 'Responsible team' }}
              <input [value]="f.information_folder_lookup_responsible_team" disabled>
            </label>
          </div>
          <label class="wide">{{ lang.isGerman() ? 'Beschreibung' : 'Description' }}
            <textarea rows="3" formControlName="information_folder_textfield_description"></textarea>
          </label>
          <footer>
            <button type="button" class="ghost-light" (click)="editing.set(false)">{{ lang.isGerman() ? 'Abbrechen' : 'Cancel' }}</button>
            <button type="submit" class="primary-light" [disabled]="editForm.invalid || saving()">
              {{ lang.isGerman() ? 'Speichern' : 'Save' }}
            </button>
          </footer>
        </form>
      }

      <div class="cols">
        <section class="card">
          <h2>{{ lang.isGerman() ? 'Abschlussgrad' : 'Completion' }}</h2>
          <im-completion-bar [data]="stats()" />
          <im-version-timeline [folderId]="f.id" />
        </section>
      </div>
    }
  `
})
export class FolderDetailComponent {
  private readonly data = inject(DataPort);
  private readonly fb = inject(FormBuilder);
  readonly session = inject(SessionService);
  readonly lang = inject(LanguageService);

  readonly id = input.required<string>();
  private readonly refresh = signal(0);
  readonly folder = toSignal(
    combineLatest([toObservable(this.id), toObservable(this.refresh)]).pipe(
      switchMap(([id]) => this.data.folder(id))));
  private readonly acks = toSignal(
    toObservable(this.id).pipe(switchMap((id) => this.data.acknowledgements({ folderId: id }))),
    { initialValue: [] });

  readonly stats = computed(() => completion(this.acks().map((a) => a.acknowledgment_picklist_status)));
  readonly frozen = computed(() => this.folder()?.information_folder_picklist_status === 'Active');
  readonly canEditPublished = computed(() => this.frozen() && this.session.canCreateFolder());
  readonly showDelete = computed(() => { const f = this.folder(); return !!f && canDelete(f); });
  editable(field: Parameters<typeof isFieldEditable>[1]): boolean {
    const f = this.folder();
    return !!f && isFieldEditable(f, field);
  }

  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly editForm = this.fb.nonNullable.group({
    information_folder_number_deadlinedays: [14, [Validators.required, Validators.min(1)]],
    information_folder_textfield_description: ['']
  });

  startEdit(f: NonNullable<ReturnType<typeof this.folder>>): void {
    this.editForm.setValue({
      information_folder_number_deadlinedays: f.information_folder_number_deadlinedays,
      information_folder_textfield_description: f.information_folder_textfield_description ?? ''
    });
    this.editing.set(true);
  }

  saveMetadata(folderId: string): void {
    if (this.editForm.invalid) return;
    this.saving.set(true);
    this.data.updateFolder(folderId, this.editForm.getRawValue()).subscribe(() => {
      this.saving.set(false);
      this.editing.set(false);
      this.refresh.update((n) => n + 1);
    });
  }
}
