import { Injectable, inject, signal } from '@angular/core';
import { DocumentVersion } from '@core/models';
import { SessionService } from './session.service';
import { MOCK_VERSIONS } from '@core/mock/mock-data';

@Injectable({ providedIn: 'root' })
export class DocumentVersionService {
  private readonly session = inject(SessionService);
  private readonly store = signal<DocumentVersion[]>(MOCK_VERSIONS);

  forFolder(folderId: string): DocumentVersion[] {
    return this.store()
      .filter((v) => v.informationFolderId === folderId)
      .sort((a, b) => b.versionId.localeCompare(a.versionId));
  }

  activeVersion(folderId: string): DocumentVersion | undefined {
    return this.store().find((v) => v.informationFolderId === folderId && v.versionStatus === 'Active');
  }

  /** VersionUtil.validateDocumentOperation — PDF only, and never for the recipient role. */
  validateUpload(file: { name: string; type: string }): { ok: boolean; errorKey?: string; params?: Record<string, string> } {
    if (this.session.isRecipient()) return { ok: false, errorKey: 'error.recipientBlocked' };
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) return { ok: false, errorKey: 'error.pdfOnly', params: { file: file.name } };
    return { ok: true };
  }

  /**
   * Activating deactivates every other version of the folder (deactivatePreviousActiveVersions),
   * stamps Valid From / Valid Until, recreates acknowledgements for the whole audience and
   * builds the AI embedding.
   */
  activate(versionId: string): void {
    const now = new Date().toISOString();
    const target = this.store().find((v) => v.id === versionId);
    if (!target) return;
    this.store.update((list) =>
      list.map((v) => {
        if (v.id === versionId) return { ...v, versionStatus: 'Active', validFrom: now, validUntil: null };
        if (v.informationFolderId === target.informationFolderId && v.versionStatus === 'Active') {
          return { ...v, versionStatus: 'Inactive', validUntil: now };
        }
        return v;
      })
    );
  }
}
