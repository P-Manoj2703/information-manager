import { Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { OBJECT_ID } from '@core/objects';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { AckStatus } from '@core/models/enums';

interface AckRecord {
  id: string;
  acknowledgment_textfield_employee: string;
  documentVersionLabel: string;
  acknowledgement_date_deadline_date: string;
  acknowledgment_picklist_status: AckStatus;
  description: string;
}

/**
 * Real record view for a single acknowledgement, reached from the chase table. Fetched via
 * single-record GET (always reliable in this tenant, unlike the generic list endpoint) rather
 * than filtering a bulk fetch — mirrors every other record-detail screen in this app.
 *
 * Field set: ECAP's own Default Layout rule "CU-Disable and Hide Fields" (condition "true" —
 * applies to every viewer) permanently hides Email, User, Information Folder, Information
 * Folder Created By, Responsible Team, and the "User Information" message on this object's own
 * record page, leaving Employee/Document Version/Description/Acknowledgment Status/Deadline
 * Date as the only Basic Information fields ever shown there. Created By/Modified By/Date
 * Created/Date Modified are technically still visible on ECAP's own page (just read-only), but
 * dropped here too per explicit request — this screen intentionally shows less than ECAP does.
 */
@Component({
  selector: 'im-ack-record-detail',
  standalone: true,
  imports: [RouterLink, StatusBadgeComponent],
  styleUrl: './ack-record-detail.component.scss',
  template: `
    <a class="back" routerLink="/acknowledgements">← {{ lang.t('acknowledgements') }}</a>

    @if (ack(); as a) {
      <section class="card">
        <header class="head">
          <im-status-badge [status]="a.acknowledgment_picklist_status" />
          <h1>{{ a.acknowledgment_textfield_employee }}</h1>
        </header>

        <div class="grid">
          <div class="field">
            <span class="label">{{ lang.isGerman() ? 'Mitarbeiter' : 'Employee' }}</span>
            <span>{{ a.acknowledgment_textfield_employee }}</span>
          </div>
          <div class="field">
            <span class="label">{{ lang.t('version') }}</span>
            <span class="mono">{{ a.documentVersionLabel || '—' }}</span>
          </div>
          <div class="field wide">
            <span class="label">{{ lang.isGerman() ? 'Beschreibung' : 'Description' }}</span>
            <span>{{ a.description || '—' }}</span>
          </div>
          <div class="field">
            <span class="label">{{ lang.t('status') }}</span>
            <im-status-badge [status]="a.acknowledgment_picklist_status" [dot]="false" />
          </div>
          <div class="field">
            <span class="label">{{ lang.t('deadline') }}</span>
            <span>{{ a.acknowledgement_date_deadline_date ? lang.date(a.acknowledgement_date_deadline_date) : '—' }}</span>
          </div>
        </div>
      </section>
    } @else if (!loading()) {
      <p class="missing">{{ lang.isGerman() ? 'Kenntnisnahme nicht gefunden.' : 'Acknowledgement not found.' }}</p>
    }
  `
})
export class AckRecordDetailComponent {
  private readonly http = inject(HttpClient);
  readonly lang = inject(LanguageService);

  readonly id = input.required<string>();
  readonly loading = signal(true);

  readonly ack = toSignal(
    toObservable(this.id).pipe(
      switchMap((id) => this.fetchAck(id)),
      map((a) => { this.loading.set(false); return a; })
    ),
    { initialValue: null as AckRecord | null }
  );

  private fetchAck(id: string): Observable<AckRecord | null> {
    if (!id) return of(null);
    return this.http.get<any>(`/networking/rest/record/${OBJECT_ID.acknowledgement}/${id}`, {
      params: { alt: 'json' }
    }).pipe(
      map((response): AckRecord | null => {
        const r = response?.platform?.record;
        if (!r) return null;
        return {
          id: r.id,
          acknowledgment_textfield_employee: r.acknowledgment_textfield_employee ?? '',
          documentVersionLabel: r.documentversion_record?.displayValue ?? '',
          acknowledgement_date_deadline_date: r.acknowledgement_date_deadline_date ?? '',
          // Picklist fields come back as {displayValue, content} objects from this endpoint, not plain strings.
          acknowledgment_picklist_status: (r.acknowledgment_picklist_status?.content ?? 'None') as AckStatus,
          description: r.description ?? ''
        };
      }),
      catchError((err) => { console.error('Acknowledgement fetch failed', err); return of(null); })
    );
  }
}
