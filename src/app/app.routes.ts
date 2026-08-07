import { Routes } from '@angular/router';
import { roleGuard } from '@core/guards/role.guard';
import { authGuard } from '@core/guards/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('@features/auth/login.component').then((m) => m.LoginComponent) },

  {
    path: '',
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'tasks' },

      {
        path: 'tasks',
        canActivate: [roleGuard(['kenntnissnahmeempfaenger'])],
        loadComponent: () => import('@features/acknowledgement/task-list.component').then((m) => m.TaskListComponent)
      },
      {
        path: 'tasks/:id',
        loadComponent: () => import('@features/acknowledgement/ack-detail.component').then((m) => m.AckDetailComponent)
      },
      {
        path: 'tasks/:id/receipt',
        loadComponent: () => import('@features/acknowledgement/ack-receipt.component').then((m) => m.AckReceiptComponent)
      },
      {
        path: 'documents',
        loadComponent: () => import('@features/acknowledgement/my-documents.component').then((m) => m.MyDocumentsComponent)
      },

      {
        path: 'folders',
        canActivate: [roleGuard(['informationsbereitsteller', 'complianceverantwortlicher'])],
        loadComponent: () => import('@features/folder/folder-list.component').then((m) => m.FolderListComponent)
      },
      {
        path: 'folders/new',
        canActivate: [roleGuard(['informationsbereitsteller'])],
        loadComponent: () => import('@features/folder/folder-wizard.component').then((m) => m.FolderWizardComponent)
      },
      {
        path: 'folders/:id',
        loadComponent: () => import('@features/folder/folder-detail.component').then((m) => m.FolderDetailComponent)
      },
      {
        path: 'folders/:id/versions/new',
        canActivate: [roleGuard(['informationsbereitsteller'])],
        loadComponent: () => import('@features/folder/version-form.component').then((m) => m.VersionFormComponent)
      },
      {
        path: 'folders/:id/versions/:versionId',
        loadComponent: () => import('@features/folder/version-detail.component').then((m) => m.VersionDetailComponent)
      },

      {
        path: 'templates',
        canActivate: [roleGuard(['informationsbereitsteller'])],
        loadComponent: () => import('@features/distribution/template-list.component').then((m) => m.TemplateListComponent)
      },
      {
        path: 'templates/new',
        canActivate: [roleGuard(['informationsbereitsteller'])],
        loadComponent: () => import('@features/distribution/template-builder.component').then((m) => m.TemplateBuilderComponent)
      },
      {
        path: 'templates/:id',
        loadComponent: () => import('@features/distribution/template-builder.component').then((m) => m.TemplateBuilderComponent)
      },

      {
        path: 'acknowledgements',
        canActivate: [roleGuard(['informationsbereitsteller', 'complianceverantwortlicher'])],
        loadComponent: () => import('@features/compliance/chase-table.component').then((m) => m.ChaseTableComponent)
      },
      {
        path: 'acknowledgements/:id',
        canActivate: [roleGuard(['informationsbereitsteller', 'complianceverantwortlicher'])],
        loadComponent: () => import('@features/compliance/ack-record-detail.component').then((m) => m.AckRecordDetailComponent)
      },
      {
        path: 'estate',
        canActivate: [roleGuard(['complianceverantwortlicher'])],
        loadComponent: () => import('@features/compliance/estate-overview.component').then((m) => m.EstateOverviewComponent)
      },

      {
        path: 'users',
        canActivate: [roleGuard(['informationsbereitsteller'])],
        loadComponent: () => import('@features/admin/user-list.component').then((m) => m.UserListComponent)
      },
      {
        path: 'teams',
        canActivate: [roleGuard(['informationsbereitsteller'])],
        loadComponent: () => import('@features/admin/team-tree.component').then((m) => m.TeamTreeComponent)
      },
      {
        path: 'monitoring',
        canActivate: [roleGuard(['complianceverantwortlicher'])],
        loadComponent: () => import('@features/admin/monitoring.component').then((m) => m.MonitoringComponent)
      },

      { path: '**', redirectTo: 'tasks' }
    ]
  }
];
