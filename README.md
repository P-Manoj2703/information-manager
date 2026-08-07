# Information Manager — Angular frontend

Angular 18, standalone components, no NgModules. Mirrors the prototype in
`Information Manager.dc.html`.

## Run

```bash
npm install
npm start          # http://localhost:4200
npm run build
```

## Structure

```
src/app/
  core/
    models/          Typed mirrors of the AgileApps objects (field names kept verbatim)
    services/        Data access + session. Swap MockDataService for HttpDataService.
    i18n/            DE/EN dictionary + LanguageService
  shared/
    ui/              Presentational components (badge, chip-bar, progress, empty-state…)
    pipes/
  features/
    acknowledgement/ Recipient task list, detail, receipt
    folder/          Portfolio list, create wizard, detail, new version
    distribution/    Template list + audience builder
    compliance/      Estate overview, chase table, override dialog
    admin/           Users, team tree, monitoring
  layout/            Shell (rail + header)
  app.routes.ts      Role-guarded routing
styles/
  _tokens.scss       ESCRIBA design tokens (from colors_and_type.css)
  styles.scss
```

## Key rules encoded in code, not comments

| Rule | Where |
|---|---|
| Recipient has no update right on Acknowledgement | `AcknowledgementService.complete()` posts a **task completion**, never a record update |
| Roll-up priority Overdue > Pending > Done(100%) > Obsolete > None | `rollup.ts` |
| Active folder is frozen except Description | `folder-detail` uses `isFieldEditable()` from `folder-rules.ts` |
| PDF-only upload | `VersionUploadComponent`, plus server message passthrough |
| Template copies then clears the lookup | `DistributionService.applyToFolder()` |
| Row security by creator + primaryTeamId | `FolderService.visibleTo()` |

## Replacing the mock backend

`MockDataService` implements `DataPort`. Point `API_BASE` at the tenant and provide
`HttpDataService` instead in `app.config.ts`. REST shapes follow the AgileApps
`/networking/rest/record/{objectId}` convention; object ids live in `core/objects.ts`.
