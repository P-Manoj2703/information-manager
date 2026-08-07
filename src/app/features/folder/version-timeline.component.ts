import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs';
import { DataPort } from '@core/services/data.port';
import { LanguageService } from '@core/i18n/language.service';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { DocumentVersion } from '@core/models';

/** UC-IP-05 — valid-from → valid-until, exactly one Active. Each entry opens that version's own record. */
@Component({
  selector: 'im-version-timeline',
  standalone: true,
  imports: [RouterLink, StatusBadgeComponent],
  styles: [`
    ol { list-style:none; margin:0; padding:0; }
    li { display:flex; gap:14px; align-items:flex-start; }
    .marker { display:flex; flex-direction:column; align-items:center; padding-top:4px; }
    .dot { width:10px; height:10px; border-radius:var(--radius-pill); background:var(--border-2); }
    .dot.on { background:var(--escriba-teal); box-shadow:0 0 0 4px rgba(11,197,181,.18); }
    .line { width:2px; flex:1; min-height:44px; background:var(--border-1); margin-top:4px; }
    .body { flex:1; padding-bottom:18px; display:flex; flex-direction:column; gap:4px; text-decoration:none; color:inherit;
            border-radius:8px; margin:-6px -8px; padding:6px 8px;
            &:hover { background:var(--bg-2); } }
    .id { font-family:var(--font-mono); font-size:13px; font-weight:600; }
    .range { font-size:12px; color:var(--fg-3); }
  `],
  template: `
    <ol>
      @for (v of versions(); track v.id; let last = $last) {
        <li>
          <span class="marker">
            <span class="dot" [class.on]="v.version_picklist_version_status === 'Active'"></span>
            @if (!last) { <span class="line"></span> }
          </span>
          <a class="body" [routerLink]="['/folders', folderId(), 'versions', v.id]">
            <span><b class="id">{{ v.version_text_field_version_id }}</b>
              <im-status-badge [status]="v.version_picklist_version_status" [dot]="false" /></span>
            <span class="range tabular">
              {{ v.version_date_time_valid_from ? lang.date(v.version_date_time_valid_from) : '—' }}
              @if (v.version_date_time_valid_until) { — {{ lang.date(v.version_date_time_valid_until) }} }
            </span>
          </a>
        </li>
      }
    </ol>
  `
})
export class VersionTimelineComponent {
  private readonly data = inject(DataPort);
  readonly lang = inject(LanguageService);
  readonly folderId = input.required<string>();
  readonly versions = toSignal(
    toObservable(this.folderId).pipe(switchMap((id) => this.data.versions(id))),
    { initialValue: [] as DocumentVersion[] });
}
