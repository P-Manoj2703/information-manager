import { Component, input } from '@angular/core';

@Component({
  selector: 'im-empty-state',
  standalone: true,
  styles: [`
    :host { display: block; padding: 56px 24px; text-align: center; }
    h3 { margin: 0 0 8px; font-size: 15px; font-weight: 600; }
    p { margin: 0 auto; max-width: 44ch; font-size: 13px; color: var(--fg-3); line-height: 1.6; }
  `],
  template: `<h3>{{ title() }}</h3><p>{{ body() }}</p><ng-content />`
})
export class EmptyStateComponent {
  readonly title = input.required<string>();
  readonly body = input('');
}
