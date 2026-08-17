import { Component } from '@angular/core';
import { ShellComponent } from './layout/shell.component';

@Component({
  selector: 'im-root',
  standalone: true,
  imports: [ShellComponent],
  templateUrl: './app.component.html'
})
export class AppComponent {}
