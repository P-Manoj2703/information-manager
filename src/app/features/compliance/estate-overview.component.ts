import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DataPort } from '@core/services/data.port';
import { LanguageService } from '@core/i18n/language.service';
import { completion } from '@core/rollup';
import { InformationFolder, Acknowledgement } from '@core/models';
import { StatusBadgeComponent } from '@shared/ui/status-badge.component';
import { CompletionBarComponent } from '@shared/ui/completion-bar.component';

/** UC-CMP-01 — portfolio view; compliance sees all folders regardless of owner. */
@Component({
  selector: 'im-estate-overview',
  standalone: true,
  imports: [RouterLink, StatusBadgeComponent, CompletionBarComponent],
  styles: [`
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(330px,1fr)); gap:16px; }
    .tile { background:#fff; border:1px solid var(--border-1); border-radius:var(--radius-card);
            padding:20px 22px; display:flex; flex-direction:column; gap:14px; box-shadow:var(--shadow-xs);
            transition:transform 120ms ease, box-shadow 120ms ease;
            &:hover { transform:translateY(-2px); box-shadow:var(--shadow-md); } }
    h2 { margin:0; font-size:16px; font-weight:600; line-height:1.35; }
    .meta { font-size:12px; color:var(--fg-3); }
  `],
  template: `
    <div class="grid">
      @for (f of folders(); track f.id) {
        <a class="tile" [routerLink]="['/folders', f.id]">
          <im-status-badge [status]="f.information_folder_picklist_acknowledgment_status" />
          <h2>{{ f.information_folder_textfield_name }}</h2>
          <span class="meta">{{ f.information_folder_picklist_confidentiality_level }}</span>
          <im-completion-bar [data]="stats(f.id)" [showLegend]="false" />
        </a>
      }
    </div>
  `
})
export class EstateOverviewComponent {
  private readonly data = inject(DataPort);
  readonly lang = inject(LanguageService);
  readonly folders = toSignal(this.data.folders(), { initialValue: [] as InformationFolder[] });
  private readonly acks = toSignal(this.data.acknowledgements({}), { initialValue: [] as Acknowledgement[] });

  stats(folderId: string) {
    return completion(this.acks()
      .filter((a) => a.acknowledgement_lookup_information_folder === folderId)
      .map((a) => a.acknowledgment_picklist_status));
  }
}
