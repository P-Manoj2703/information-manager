import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { OBJECT_ID } from '@core/objects';

const DISTRIBUTION_LIST_TEAMS_OBJECT = '4c8a796eb68640e790ceda13abb8e9e1';
const DISTRIBUTION_LIST_USERS_OBJECT = 'e180bc457fc9435ab8f993f475ad0a9c';

interface TemplateRow { id: string; name: string; teamCount: number; userCount: number; }

/**
 * Real Distribution_Lists list. Shows direct team/user counts per template — not a
 * "resolved via hierarchy" headcount, since ECAP's own Distribution Template list doesn't
 * show one either (its Teams/Users columns just list the linked names directly).
 */
@Component({
  selector: 'im-template-list',
  standalone: true,
  imports: [RouterLink],
  styles: [`
    .bar { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
    .intro { font-size:13px; color:var(--fg-2); max-width:70ch; line-height:1.6; margin:0; }
    .spacer { flex: 1; }
    .new { background: var(--escriba-teal); color: var(--navy-900); padding: 11px 20px;
           border-radius: var(--radius-pill); font-weight: 600; white-space: nowrap; }
    table { width:100%; border-collapse:collapse; background:#fff; border:1px solid var(--border-1);
            border-radius:var(--radius-card); overflow:hidden; }
    th { text-align:left; font-size:11px; font-weight:700; letter-spacing:.08em; color:var(--fg-3);
         background:var(--bg-2); padding:12px 20px; }
    td { padding:16px 20px; border-top:1px solid var(--border-1); font-size:14px; }
    .empty { color:var(--fg-3); font-size:13px; padding:20px; }
  `],
  template: `
    <div class="bar">
      <p class="intro">
        {{ lang.isGerman()
          ? 'Eine Verteilervorlage bündelt Teams und Personen zu einer wiederverwendbaren Zielgruppe. Beim Anwenden werden die Mitglieder einmalig kopiert.'
          : 'A distribution template bundles teams and people into a reusable audience. Applying it copies the members once.' }}
      </p>
      <span class="spacer"></span>
      <a class="new" routerLink="/templates/new">
        {{ lang.isGerman() ? 'Neue Verteilervorlage' : 'New distribution template' }}
      </a>
    </div>
    @if (loading()) {
      <p class="empty">{{ lang.isGerman() ? 'Vorlagen werden geladen…' : 'Loading templates…' }}</p>
    } @else {
      <table>
        <thead><tr><th>{{ lang.t('templates') }}</th><th>{{ lang.isGerman() ? 'Organisationseinheiten' : 'Organisational units' }}</th><th>{{ lang.t('users') }}</th></tr></thead>
        <tbody>
          @for (t of templates(); track t.id) {
            <tr>
              <td><a [routerLink]="['/templates', t.id]">{{ t.name }}</a></td>
              <td>{{ t.teamCount }}</td>
              <td>{{ t.userCount }}</td>
            </tr>
          } @empty {
            <tr><td colspan="3" class="empty">{{ lang.isGerman() ? 'Noch keine Verteilervorlagen.' : 'No distribution templates yet.' }}</td></tr>
          }
        </tbody>
      </table>
    }
  `
})
export class TemplateListComponent {
  private readonly http = inject(HttpClient);
  readonly lang = inject(LanguageService);

  readonly loading = signal(true);

  readonly templates = toSignal(
    this.fetchTemplates().pipe(map((rows) => { this.loading.set(false); return rows; })),
    { initialValue: [] as TemplateRow[] }
  );

  private static readonly PAGE_SIZE = 5;
  private static readonly MAX_PAGES = 8;
  private static readonly MAX_RETRIES_PER_PAGE = 5;

  /**
   * Same retry-hardened fetch as the audience builder's own template picker — this tenant has
   * a confirmed set of individually-corrupted Distribution_Lists records that a larger page
   * size can't reliably retrieve past, hence pageSize 5 here too.
   */
  private fetchPageWithRetry(page: number, pageSize: number, attempt = 0): Observable<{ rows: { id: string; name: string }[]; total: number }> {
    return this.http.get<any>(`/networking/rest/record/${OBJECT_ID.distributionTemplate}`, {
      params: { fieldList: 'id,distribution_list_tf_distribution_list_name', page, pageSize, getTotalRecordCount: true, alt: 'json' }
    }).pipe(
      map((response) => ({
        rows: [response?.platform?.record ?? []].flat().map((r: any) => ({ id: r.id, name: r.distribution_list_tf_distribution_list_name ?? '' })),
        total: Number(response?.platform?.totalRecordCount ?? 0)
      })),
      catchError((err) => { console.error(`Template fetch (page ${page}, attempt ${attempt}) failed`, err); return of({ rows: [], total: 0 }); }),
      switchMap((result) => {
        if (result.rows.length < pageSize && attempt < TemplateListComponent.MAX_RETRIES_PER_PAGE) {
          return this.fetchPageWithRetry(page, pageSize, attempt + 1);
        }
        return of(result);
      })
    );
  }

  private fetchAllTemplates(): Observable<{ id: string; name: string }[]> {
    return new Observable((subscriber) => {
      const seen = new Map<string, { id: string; name: string }>();
      let total = Infinity;
      const nextPage = (page: number) => {
        if (page > TemplateListComponent.MAX_PAGES || seen.size >= total) {
          subscriber.next([...seen.values()]);
          subscriber.complete();
          return;
        }
        this.fetchPageWithRetry(page, TemplateListComponent.PAGE_SIZE).subscribe((result) => {
          if (result.total > 0) total = result.total;
          result.rows.forEach((r) => seen.set(r.id, r));
          nextPage(page + 1);
        });
      };
      nextPage(1);
    });
  }

  private fetchCount(objectId: string, templateId: string): Observable<number> {
    return this.http.get<any>(`/networking/rest/record/${objectId}`, {
      params: { filter: `(distributionlist_record equals '${templateId}')`, fieldList: 'id', pageSize: 1, getTotalRecordCount: true, alt: 'json' }
    }).pipe(
      map((response) => Number(response?.platform?.totalRecordCount ?? 0)),
      catchError((err) => { console.error(`Count fetch failed for ${objectId}`, err); return of(0); })
    );
  }

  private fetchTemplates(): Observable<TemplateRow[]> {
    return this.fetchAllTemplates().pipe(
      switchMap((rows) => {
        if (!rows.length) return of([] as TemplateRow[]);
        return new Observable<TemplateRow[]>((subscriber) => {
          const results: TemplateRow[] = [];
          let remaining = rows.length;
          rows.forEach((r) => {
            this.fetchCount(DISTRIBUTION_LIST_TEAMS_OBJECT, r.id).subscribe((teamCount) => {
              this.fetchCount(DISTRIBUTION_LIST_USERS_OBJECT, r.id).subscribe((userCount) => {
                results.push({ id: r.id, name: r.name, teamCount, userCount });
                remaining--;
                if (remaining === 0) { subscriber.next(results); subscriber.complete(); }
              });
            });
          });
        });
      })
    );
  }
}
