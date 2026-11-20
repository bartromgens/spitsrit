import * as Sentry from '@sentry/angular';
import { ClientConfig } from './api/models';

export function initSentry(config: ClientConfig): void {
  if (!config.sentry_dsn) {
    return;
  }
  Sentry.init({
    dsn: config.sentry_dsn,
    environment: config.environment,
    release: config.release,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
  });
}
