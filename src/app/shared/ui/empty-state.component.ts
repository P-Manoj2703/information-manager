import { Component, input } from '@angular/core';

@Component({
  selector: 'im-empty-state',
  standalone: true,
  templateUrl: './empty-state.component.html',
  styleUrl: './empty-state.component.scss'
})
export class EmptyStateComponent {
  readonly title = input.required<string>();
  readonly body = input('');
}
