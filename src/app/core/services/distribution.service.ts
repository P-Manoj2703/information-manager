import { Injectable, inject } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { DataPort } from './data.port';

@Injectable({ providedIn: 'root' })
export class DistributionService {
  private readonly data = inject(DataPort);

  /**
   * DistributionListAttachingHandler: copies the template's users and teams
   * onto the folder's junctions and then CLEARS the lookup. The folder keeps
   * no live link — surface that to the user.
   */
  applyToFolder(folderId: string, templateId: string): Observable<void> {
    return this.data.applyTemplateToFolder(folderId, templateId).pipe(
      tap(() => console.info('[distribution] members copied; lookup cleared by server'))
    );
  }
}
