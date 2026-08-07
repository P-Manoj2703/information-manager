import { Component } from '@angular/core';
import { ShellComponent } from './layout/shell.component';

@Component({
  selector: 'im-root',
  standalone: true,
  imports: [ShellComponent],
  template: '<im-shell />'
})
export class AppComponent {}
