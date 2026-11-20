import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withXsrfConfiguration } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import * as Sentry from '@sentry/angular';
import { Api } from './api/api';
import { configRetrieve } from './api/functions';
import { routes } from './app.routes';
import { Auth } from './auth';
import { initSentry } from './sentry';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // Django's CSRF cookie and header names.
    provideHttpClient(
      withXsrfConfiguration({ cookieName: 'csrftoken', headerName: 'X-CSRFToken' }),
    ),
    { provide: ErrorHandler, useValue: Sentry.createErrorHandler() },
    provideAppInitializer(async () => {
      const api = inject(Api);
      const auth = inject(Auth);
      inject(Sentry.TraceService);
      initSentry(await api.invoke(configRetrieve));
      await auth.load();
    }),
  ],
};
