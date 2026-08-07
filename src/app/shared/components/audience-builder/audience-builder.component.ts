import { Component, computed, inject, input, model, output } from '@angular/core';
import { OrganizationalUnitLink, Team } from '@core/models';
import { AudienceService, AudienceMember } from '@core/services/audience.service';
import { I18nService } from '@core/i18n/i18n.service';
import { TranslatePipe } from '@core/i18n/translate.pipe';

/**
 * The single audience surface — used by the folder wizard AND the distribution template builder.
 * Merges teams, individual people and the template picker so the user never has to know they
 * are three different mechanisms in the platform.
 */
@Component({
  selector: 'im-audience-builder',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './audience-builder.component.html',
  styleUrl: './audience-builder.component.scss'
})
export class AudienceBuilderComponent {
  private readonly audience = inject(AudienceService);
  private readonly i18n = inject(I18nService);

  readonly teams = input.required<Team[]>();
  readonly directMembers = input<AudienceMember[]>([]);
  readonly membersOfTeam = input.required<(teamId: string) => AudienceMember[]>();

  readonly links = model.required<OrganizationalUnitLink[]>();
  readonly templateApplied = input(false);
  readonly applyTemplate = output<string>();

  readonly resolution = computed(() =>
    this.audience.resolve(this.teams(), this.links(), this.directMembers(), this.membersOfTeam())
  );

  readonly linkedRows = computed(() =>
    this.links().map((link) => {
      const team = this.teams().find((t) => t.id === link.teamId)!;
      const children = link.includeTeamHierarchy ? this.audience.descendants(this.teams(), link.teamId) : [];
      return { link, team, children, childCount: children.reduce((s, c) => s + c.memberCount, 0) };
    })
  );

  readonly addable = computed(() =>
    this.teams().filter((t) => t.parentTeamId !== null && !this.links().some((l) => l.teamId === t.id))
  );

  toggleHierarchy(link: OrganizationalUnitLink): void {
    this.links.update((list) =>
      list.map((l) => (l.id === link.id ? { ...l, includeTeamHierarchy: !l.includeTeamHierarchy } : l))
    );
  }

  /** Duplicate rows are rejected server-side; the message is rendered inline on the offending row. */
  duplicateWarning(link: OrganizationalUnitLink): string | null {
    const parent = this.audience.findCoveringParent(this.teams(), this.links(), link.teamId);
    if (!parent) return null;
    const team = this.teams().find((t) => t.id === link.teamId)!;
    return this.i18n.t('error.teamDuplicateHierarchy', { team: team.name, parent: parent.name });
  }

  addTeam(team: Team): void {
    this.links.update((list) => [
      ...list,
      { id: 'ou-' + team.id, informationFolderId: '', teamId: team.id, includeTeamHierarchy: false }
    ]);
  }

  removeTeam(link: OrganizationalUnitLink): void {
    this.links.update((list) => list.filter((l) => l.id !== link.id));
  }
}
