import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withXsrfConfiguration } from '@angular/common/http';
import {
  MAT_FORM_FIELD_DEFAULT_OPTIONS,
  MatFormFieldDefaultOptions,
} from '@angular/material/form-field';
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
    // Outlined fields: lighter than Material's grey filled boxes, and they sit well on white.
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'outline' } satisfies MatFormFieldDefaultOptions,
    },
    provideAppInitializer(async () => {
      const api = inject(Api);
      const auth = inject(Auth);
      inject(Sentry.TraceService);
      initSentry(await api.invoke(configRetrieve));
      await auth.load();
    }),
  ],
};
