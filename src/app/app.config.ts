import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { routes } from './app.routes';
import { DataPort } from '@core/services/data.port';
import { MockDataService } from '@core/services/mock-data.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch()),
    // Swap for HttpDataService when the tenant REST endpoints are wired up.
    { provide: DataPort, useClass: MockDataService }
  ]
};
