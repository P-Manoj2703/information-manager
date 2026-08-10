import { APP_INITIALIZER, ApplicationConfig, importProvidersFrom, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { MatNativeDateModule } from '@angular/material/core';
import { AppConfigService, apiPrefixInterceptor } from '@escriba/cui-core';
import { LookupService, StartPageApiService } from '@escriba/cui-ecap-runtime';
import { routes } from './app.routes';
import { DataPort } from '@core/services/data.port';
import { MockDataService } from '@core/services/mock-data.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideAnimations(),
    importProvidersFrom(MatNativeDateModule),
    provideHttpClient(withFetch(), withInterceptors([apiPrefixInterceptor])),
    {
      provide: APP_INITIALIZER,
      multi: true,
      deps: [AppConfigService, StartPageApiService],
      useFactory: (appConfigService: AppConfigService, startPageApiService: StartPageApiService) => () =>
        appConfigService.getAppConfig().then(() => startPageApiService.getStartPage())
    },
    // Still backs every feature area except Information Folder while ECAP wiring proceeds feature by feature.
    { provide: DataPort, useClass: MockDataService },
    // Root-level so SessionService (also root) can resolve the logged-in user's primary team name to an id.
    LookupService
  ]
};
