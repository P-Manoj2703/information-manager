import { Injectable, computed, inject, signal } from '@angular/core';
import { InformationFolder } from '@core/models';
import { SessionService } from './session.service';
import { MOCK_FOLDERS } from '@core/mock/mock-data';

export type FolderView = 'myActive' | 'myDraft' | 'myInactive' | 'teamActive' | 'teamDraft' | 'teamInactive' | 'all';

@Injectable({ providedIn: 'root' })
export class InformationFolderService {
  private readonly session = inject(SessionService);
  private readonly store = signal<InformationFolder[]>(MOCK_FOLDERS);
  readonly view = signal<FolderView>('myActive');

  /** Access criteria: Admin and Compliance see everything, a provider sees own OR same primary team. */
  readonly visible = computed(() => {
    const all = this.store();
    if (this.session.isAdmin() || this.session.isCompliance()) return all;
    if (this.session.isProvider()) {
      return all.filter((f) => f.createdById === this.session.userId() || f.primaryTeamId === this.session.primaryTeamId());
    }
    return [];
  });

  readonly filtered = computed(() => {
    const mine = (f: InformationFolder) => f.createdById === this.session.userId();
    switch (this.view()) {
      case 'myActive': return this.visible().filter((f) => mine(f) && f.status === 'Active');
      case 'myDraft': return this.visible().filter((f) => mine(f) && f.status === 'Draft');
      case 'myInactive': return this.visible().filter((f) => mine(f) && f.status === 'Inactive');
      case 'teamActive': return this.visible().filter((f) => f.status === 'Active');
      case 'teamDraft': return this.visible().filter((f) => f.status === 'Draft');
      case 'teamInactive': return this.visible().filter((f) => f.status === 'Inactive');
      default: return this.visible();
    }
  });

  byId(id: string): InformationFolder | undefined { return this.store().find((f) => f.id === id); }

  /** Delete is only offered while Draft; published records are retained for audit. */
  canDelete(folder: InformationFolder): boolean {
    return folder.status === 'Draft' && (this.session.isAdmin() || this.session.isProvider());
  }

  /** An Active folder is frozen — only the description stays editable. */
  isFieldEditable(folder: InformationFolder, field: keyof InformationFolder): boolean {
    if (folder.status === 'Draft') return field !== 'status' && field !== 'acknowledgmentStatus';
    if (folder.status === 'Inactive') {
      return ['description', 'confidentialityLevel', 'documentCategory', 'documentLanguage', 'responsibleTeamId'].includes(field as string);
    }
    return field === 'description';
  }

  /** Validation "At least one Document Version is required to activate". */
  canActivate(folder: InformationFolder, versionCount: number): { ok: boolean; reason?: string } {
    if (versionCount === 0) return { ok: false, reason: 'error.activateNeedsVersion' };
    return { ok: true };
  }
}
