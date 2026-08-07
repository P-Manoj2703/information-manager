import { Component, input } from '@angular/core';

/** Done / Pending / Overdue split. The folder shows "Done" only at 100 % (strict roll-up). */
@Component({
  selector: 'im-completion-bar',
  standalone: true,
  template: `
    <div class="bar">
      <span class="bar__seg bar__seg--done" [style.width.%]="done()"></span>
      <span class="bar__seg bar__seg--pending" [style.width.%]="pending()"></span>
      <span class="bar__seg bar__seg--overdue" [style.width.%]="overdue()"></span>
    </div>
  `,
  styles: [`
    .bar { display: flex; height: 8px; border-radius: var(--radius-pill); overflow: hidden; background: var(--bg-3); }
    .bar__seg--done { background: var(--escriba-teal); }
    .bar__seg--pending { background: var(--escriba-blue); }
    .bar__seg--overdue { background: var(--danger); }
  `]
})
export class CompletionBarComponent {
  readonly done = input(0);
  readonly pending = input(0);
  readonly overdue = input(0);
}
