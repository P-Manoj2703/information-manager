import { Component, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { LanguageService } from '@core/i18n/language.service';

/** UC-ADM-04 — external Angular app; needs its own loading and error state. */
@Component({
  selector: 'im-monitoring',
  standalone: true,
  styles: [`
    :host { display:block; height:100%; }
    iframe { width:100%; height:calc(100vh - 160px); border:0; border-radius:var(--radius-card); background:#fff; }
    .error { background:#fff; border:1px solid var(--border-1); border-radius:var(--radius-card);
             padding:60px 40px; text-align:center; display:flex; flex-direction:column; align-items:center; gap:14px; }
    .ghost { border:1px solid var(--border-2); background:#fff; cursor:pointer; font:inherit; font-weight:600;
             padding:11px 20px; border-radius:var(--radius-pill); }
  `],
  template: `
    @if (failed()) {
      <div class="error">
        <h2>{{ lang.isGerman() ? 'Monitoring nicht erreichbar' : 'Monitoring unavailable' }}</h2>
        <p>{{ lang.isGerman()
          ? 'Die externe Monitoring-Anwendung antwortet nicht. Alle übrigen Bereiche bleiben nutzbar.'
          : 'The external monitoring application is not responding. All other areas remain available.' }}</p>
        <button type="button" class="ghost" (click)="retry()">{{ lang.isGerman() ? 'Erneut versuchen' : 'Retry' }}</button>
      </div>
    } @else {
      <iframe [src]="url" title="Monitoring" (error)="failed.set(true)"></iframe>
    }
  `
})
export class MonitoringComponent {
  readonly lang = inject(LanguageService);
  private readonly sanitizer = inject(DomSanitizer);
  readonly failed = signal(false);
  readonly url: SafeResourceUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
    'https://labs-dev.ecap-epm.de/networking/apps/labs/information-manager/');
  retry(): void { this.failed.set(false); }
}
