import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { LanguageService } from '@core/i18n/language.service';
import { OBJECT_ID } from '@core/objects';
import { PagerComponent } from '@shared/ui/pager.component';
import { ColumnFilterComponent, ColumnFilterOption } from '@shared/ui/column-filter.component';

const DISTRIBUTION_LIST_TEAMS_OBJECT = '4c8a796eb68640e790ceda13abb8e9e1';
const DISTRIBUTION_LIST_USERS_OBJECT = 'e180bc457fc9435ab8f993f475ad0a9c';

/** Information Manager Teams (2a4456…) — same self-referencing parent field template-builder uses to expand hierarchy. */
interface OrgTeam { id: string; name: string; parentId: string; }
interface LinkedTeam { teamId: string; includeTeamHierarchy: boolean; }

interface TemplateRow {
  id: string; name: string;
  teamsCount: number; hasHierarchy: boolean; peopleCount: number;
  resolvesTo: number; usedByCount: number;
}

/**
 * Real Distribution_Lists list. "Resolves to" / "Contains" / "Used by" are computed the
 * same way AudienceBuilderComponent and TemplateBuilderComponent already resolve a
 * template's real headcount: top-level linked teams (Distribution_List_Teams, minus the
 * rows ECAP's own hierarchy-expansion rule auto-creates per descendant), each team's real
 * member count from the Information Manager Teams x Users junction, plus directly-linked
 * people (Distribution_List_Users) — and "used by" counts real folders whose own
 * information_folder_lu_distribution_list points at this template.
 */
@Component({
  selector: 'im-template-list',
  standalone: true,
  imports: [RouterLink, PagerComponent, ColumnFilterComponent],
  styles: [`
    .bar { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
    .intro { font-size:13px; color:var(--fg-2); max-width:70ch; line-height:1.6; margin:0; }
    .spacer { flex: 1; }
    .new { background: var(--escriba-teal); color: var(--navy-900); padding: 11px 20px;
           border-radius: var(--radius-pill); font-weight: 600; white-space: nowrap; }
    .scroll { overflow-x: auto; border-radius: var(--radius-card); }
    table { width:100%; min-width:760px; border-collapse:collapse; background:#fff; border:1px solid var(--border-1);
            border-radius:var(--radius-card); overflow:hidden; }
    th { text-align:left; font-size:11px; font-weight:700; letter-spacing:.08em; color:var(--fg-3);
         background:var(--bg-2); padding:12px 20px; }
    td { padding:16px 20px; border-top:1px solid var(--border-1); font-size:14px; }
    .resolves { color: var(--escriba-teal-700); font-weight: 700; }
    .used-by { color: var(--fg-3); }
    .empty { color:var(--fg-3); font-size:13px; padding:20px; }
    .actions { text-align: right; }
    .delete { border:1px solid var(--border-2); background:#fff; color:var(--fg-2); cursor:pointer;
              font:inherit; font-size:12px; font-weight:600; padding:7px 14px; border-radius:var(--radius-pill);
              &:disabled { opacity:.5; cursor:not-allowed; } }
    .action-error { color:var(--danger); font-size:11px; margin-top:8px; text-align:right; line-height:1.4; }
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
      <div class="scroll">
      <table>
        <thead>
          <tr>
            <th>
              <im-column-filter [title]="lang.t('templates')" [options]="nameOptions()" [(selected)]="nameColumnFilter">
                {{ lang.t('templates') }}
              </im-column-filter>
            </th>
            <th>{{ lang.isGerman() ? 'Löst auf zu' : 'Resolves to' }}</th>
            <th>{{ lang.isGerman() ? 'Enthält' : 'Contains' }}</th>
            <th>
              <im-column-filter [title]="lang.isGerman() ? 'Verwendet von' : 'Used by'" [options]="usedByOptions()" [(selected)]="usedByColumnFilter">
                {{ lang.isGerman() ? 'Verwendet von' : 'Used by' }}
              </im-column-filter>
            </th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          @for (t of pagedTemplates(); track t.id) {
            <tr>
              <td><a [routerLink]="['/templates', t.id]">{{ t.name }}</a></td>
              <td class="resolves">{{ t.resolvesTo }}</td>
              <td>{{ containsText(t) }}</td>
              <td class="used-by">{{ usedByText(t) }}</td>
              <td class="actions">
                <button type="button" class="delete" [disabled]="deleting() === t.id" (click)="deleteTemplate(t)">
                  {{ lang.isGerman() ? 'Löschen' : 'Delete' }}
                </button>
                @if (actionError()?.templateId === t.id) {
                  <p class="action-error">{{ actionError()?.message }}</p>
                }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="empty">
              {{ (nameColumnFilter().length || usedByColumnFilter().length)
                ? (lang.isGerman() ? 'Keine Vorlagen entsprechen dem Filter.' : 'No templates match this filter.')
                : (lang.isGerman() ? 'Noch keine Verteilervorlagen.' : 'No distribution templates yet.') }}
            </td></tr>
          }
        </tbody>
      </table>
      </div>
      @if (templates().length) {
        <im-pager [total]="templates().length" [(page)]="currentPage" [(pageSize)]="pageSize" />
      }
    }
  `
})
export class TemplateListComponent {
  private readonly http = inject(HttpClient);
  readonly lang = inject(LanguageService);

  readonly loading = signal(true);

  private readonly fetchedTemplates = toSignal(
    forkJoin({ orgTeams: this.fetchOrgTeams(), rawTemplates: this.fetchAllTemplates() }).pipe(
      switchMap(({ orgTeams, rawTemplates }) => this.fetchTemplateStats(orgTeams, rawTemplates)),
      map((rows) => { this.loading.set(false); return rows; })
    ),
    { initialValue: [] as TemplateRow[] }
  );

  /** Deleted this session — filtered out locally rather than re-running the whole expensive stats fetch. */
  private readonly deletedIds = signal<Set<string>>(new Set());

  readonly nameColumnFilter = signal<string[]>([]);
  readonly usedByColumnFilter = signal<string[]>([]);

  /** Option lists are derived from whatever's actually loaded, not a hardcoded tenant-wide list. */
  readonly nameOptions = computed<ColumnFilterOption[]>(() =>
    [...new Set(this.fetchedTemplates().map((t) => t.name))].sort().map((n) => ({ value: n, label: n })));
  readonly usedByOptions = computed<ColumnFilterOption[]>(() => [
    { value: 'used', label: this.lang.isGerman() ? 'Verwendet' : 'Used' },
    { value: 'unused', label: this.lang.isGerman() ? 'Noch nicht verwendet' : 'Not used yet' }
  ]);

  readonly templates = computed(() => {
    const nameFilter = this.nameColumnFilter();
    const usedByFilter = this.usedByColumnFilter();
    return this.fetchedTemplates()
      .filter((t) => !this.deletedIds().has(t.id))
      .filter((t) => !nameFilter.length || nameFilter.includes(t.name))
      .filter((t) => !usedByFilter.length || usedByFilter.includes(t.usedByCount > 0 ? 'used' : 'unused'));
  });

  readonly deleting = signal<string | null>(null);
  readonly actionError = signal<{ templateId: string; message: string } | null>(null);

  readonly pageSize = signal(10);
  readonly currentPage = signal(1);

  readonly pagedTemplates = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.templates().slice(start, start + this.pageSize());
  });

  /**
   * Same single-call shape confirmed live from ECAP's own native "Delete" record action:
   * DELETE rest/record/{objectId}/{recordId}, no body, no separate cleanup calls — ECAP's own
   * UI leaves a deleted template's Distribution_List_Teams/Distribution_List_Users rows as
   * orphans too, so this replicates that exact (if imperfect) native behavior rather than
   * inventing cleanup ECAP itself doesn't do. Warns first when the template is still linked
   * to live folders (this row's own real "Used by" count), since deleting it out from under
   * them breaks their information_folder_lu_distribution_list reference.
   */
  deleteTemplate(t: TemplateRow): void {
    if (this.deleting()) return;
    const warning = t.usedByCount > 0
      ? (this.lang.isGerman()
          ? `"${t.name}" wird von ${t.usedByCount} Ordner(n) verwendet. Trotzdem löschen?`
          : `"${t.name}" is used by ${t.usedByCount} folder(s). Delete anyway?`)
      : (this.lang.isGerman() ? `"${t.name}" löschen?` : `Delete "${t.name}"?`);
    if (!confirm(warning)) return;

    this.deleting.set(t.id);
    this.actionError.set(null);
    this.http.delete(`/networking/solution/ServiceDesk/record/${OBJECT_ID.distributionTemplate}/${t.id}`).subscribe({
      next: () => {
        this.deleting.set(null);
        this.deletedIds.update((ids) => new Set([...ids, t.id]));
      },
      error: (err) => {
        console.error('Delete template failed', err);
        this.deleting.set(null);
        this.actionError.set({
          templateId: t.id,
          message: err?.error?.platform?.message?.description ?? err?.error?.__exception_msg__ ?? (this.lang.isGerman() ? 'Löschen fehlgeschlagen.' : 'Delete failed.')
        });
      }
    });
  }

  constructor() {
    effect(() => {
      this.pageSize(); this.nameColumnFilter(); this.usedByColumnFilter();
      this.currentPage.set(1);
    }, { allowSignalWrites: true });
  }

  containsText(t: TemplateRow): string {
    const parts: string[] = [];
    if (t.teamsCount > 0) {
      const teamWord = this.lang.isGerman()
        ? (t.teamsCount === 1 ? 'Team' : 'Teams')
        : (t.teamsCount === 1 ? 'team' : 'teams');
      const hierarchySuffix = t.hasHierarchy ? (this.lang.isGerman() ? ' (inkl. Hierarchie)' : ' (incl. hierarchy)') : '';
      parts.push(`${t.teamsCount} ${teamWord}${hierarchySuffix}`);
    }
    if (t.peopleCount > 0) {
      const peopleWord = this.lang.isGerman()
        ? (t.peopleCount === 1 ? 'Benutzer' : 'Benutzer')
        : (t.peopleCount === 1 ? 'user' : 'users');
      parts.push(`${t.peopleCount} ${peopleWord}`);
    }
    return parts.length ? parts.join(' · ') : (this.lang.isGerman() ? 'Leer' : 'Empty');
  }

  usedByText(t: TemplateRow): string {
    if (t.usedByCount === 0) return this.lang.isGerman() ? 'Noch nicht verwendet' : 'Not used yet';
    const folderWord = this.lang.isGerman()
      ? 'Ordner'
      : (t.usedByCount === 1 ? 'folder' : 'folders');
    return `${t.usedByCount} ${folderWord}`;
  }

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
        // A short page is only suspicious (worth retrying) if we haven't already accounted for
        // every record the server itself reported — a tenant with fewer templates than one
        // page size legitimately returns a short page on attempt 0, and retrying that is a
        // pure wasted round trip, not resilience against the known corrupted-record issue.
        const alreadyAtTotal = result.total > 0 && (page - 1) * pageSize + result.rows.length >= result.total;
        if (result.rows.length < pageSize && !alreadyAtTotal && attempt < TemplateListComponent.MAX_RETRIES_PER_PAGE) {
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

  /** All Information Manager Teams, once — shared across every template to expand hierarchy the same way TemplateBuilderComponent does. */
  private fetchOrgTeams(): Observable<OrgTeam[]> {
    const pageSize = 50;
    const mapRow = (r: any): OrgTeam => ({
      id: r.id, name: r.name, parentId: r.information_manager_teams_lookup_self_referencing?.content ?? ''
    });
    const fetchPage = (page: number): Observable<{ rows: OrgTeam[]; total: number }> =>
      this.http.get<any>(`/networking/rest/record/${OBJECT_ID.teams}`, {
        params: { fieldList: 'id,name,information_manager_teams_lookup_self_referencing', page, pageSize, getTotalRecordCount: true, alt: 'json' }
      }).pipe(
        map((response) => ({
          rows: [response?.platform?.record ?? []].flat().map(mapRow),
          total: Number(response?.platform?.totalRecordCount ?? 0)
        })),
        catchError((err) => { console.error('Org teams fetch failed', err); return of({ rows: [] as OrgTeam[], total: 0 }); })
      );

    // Page 1 tells us the real total, so every remaining page can fire in parallel instead of
    // waiting on its predecessor — this tenant's team list is read-only here, so there's no
    // risk of the total shifting between page 1 and the rest.
    return fetchPage(1).pipe(
      switchMap((first) => {
        const totalPages = Math.min(20, Math.ceil(first.total / pageSize));
        if (totalPages <= 1) return of(first.rows);
        const remaining = Array.from({ length: totalPages - 1 }, (_, i) => fetchPage(i + 2));
        return forkJoin(remaining).pipe(map((pages) => [...first.rows, ...pages.flatMap((p) => p.rows)]));
      })
    );
  }

  private fetchLinkedTeams(templateId: string): Observable<LinkedTeam[]> {
    return this.http.get<any>(`/networking/rest/record/${DISTRIBUTION_LIST_TEAMS_OBJECT}`, {
      params: { filter: `(distributionlist_record equals '${templateId}')`, fieldList: 'id,teams_record,distribution_list_teams_cb_include_team_hierarchy', alt: 'json' }
    }).pipe(
      map((response): LinkedTeam[] =>
        [response?.platform?.record ?? []].flat().map((r: any) => ({
          teamId: r.teams_record?.content ?? r.teams_record?.id ?? '',
          includeTeamHierarchy: String(r.distribution_list_teams_cb_include_team_hierarchy ?? '') === '1'
        }))),
      catchError((err) => { console.error('Linked teams fetch failed', err); return of([] as LinkedTeam[]); })
    );
  }

  private fetchCount(objectId: string, filter: string): Observable<number> {
    return this.http.get<any>(`/networking/rest/record/${objectId}`, {
      params: { filter, fieldList: 'id', pageSize: 1, getTotalRecordCount: true, alt: 'json' }
    }).pipe(
      map((response) => Number(response?.platform?.totalRecordCount ?? 0)),
      catchError((err) => { console.error(`Count fetch failed for ${objectId}`, err); return of(0); })
    );
  }

  private fetchTeamMemberCount(teamId: string): Observable<{ id: string; count: number }> {
    return this.http.get<any>(`/networking/rest/record/${OBJECT_ID.informationManagerTeamsUsers}`, {
      params: { filter: `(informationmanagerteams_record equals '${teamId}')`, fieldList: 'id', pageSize: 1, getTotalRecordCount: true, alt: 'json' }
    }).pipe(
      map((response) => ({ id: teamId, count: Number(response?.platform?.totalRecordCount ?? 0) })),
      catchError((err) => { console.error('Team member count fetch failed', teamId, err); return of({ id: teamId, count: 0 }); })
    );
  }

  private fetchTemplateStats(orgTeams: OrgTeam[], rows: { id: string; name: string }[]): Observable<TemplateRow[]> {
    const childrenByParent = new Map<string, OrgTeam[]>();
    orgTeams.forEach((t) => {
      if (!t.parentId || t.parentId === t.id) return;
      childrenByParent.set(t.parentId, [...(childrenByParent.get(t.parentId) ?? []), t]);
    });
    const descendantsOf = (teamId: string): OrgTeam[] => {
      const out: OrgTeam[] = [];
      const walk = (id: string) => (childrenByParent.get(id) ?? []).forEach((c) => { out.push(c); walk(c.id); });
      walk(teamId);
      return out;
    };

    if (!rows.length) return of([] as TemplateRow[]);
    return forkJoin(rows.map((r) =>
      forkJoin({
            linkedTeams: this.fetchLinkedTeams(r.id),
            peopleCount: this.fetchCount(DISTRIBUTION_LIST_USERS_OBJECT, `(distributionlist_record equals '${r.id}')`),
            usedByCount: this.fetchCount(OBJECT_ID.informationFolder, `(information_folder_lu_distribution_list equals '${r.id}')`)
          }).pipe(
            switchMap(({ linkedTeams, peopleCount, usedByCount }) => {
              const linkedIds = new Set(linkedTeams.map((t) => t.teamId));
              const descendantIds = new Set<string>();
              linkedTeams.filter((t) => t.includeTeamHierarchy)
                .forEach((t) => descendantsOf(t.teamId).forEach((c) => { if (linkedIds.has(c.id)) descendantIds.add(c.id); }));
              const topLevelTeams = linkedTeams.filter((t) => !descendantIds.has(t.teamId));

              const memberCountIds = new Set<string>();
              topLevelTeams.forEach((t) => {
                memberCountIds.add(t.teamId);
                if (t.includeTeamHierarchy) descendantsOf(t.teamId).forEach((c) => { if (linkedIds.has(c.id)) memberCountIds.add(c.id); });
              });

              if (!memberCountIds.size) {
                return of<TemplateRow>({
                  id: r.id, name: r.name, teamsCount: topLevelTeams.length,
                  hasHierarchy: topLevelTeams.some((t) => t.includeTeamHierarchy),
                  peopleCount, resolvesTo: peopleCount, usedByCount
                });
              }

              return forkJoin([...memberCountIds].map((id) => this.fetchTeamMemberCount(id))).pipe(
                map((counts) => {
                  const total = counts.reduce((sum, c) => sum + c.count, 0);
                  return {
                    id: r.id, name: r.name, teamsCount: topLevelTeams.length,
                    hasHierarchy: topLevelTeams.some((t) => t.includeTeamHierarchy),
                    peopleCount, resolvesTo: total + peopleCount, usedByCount
                  };
                })
              );
            })
          )
        ));
  }
}
