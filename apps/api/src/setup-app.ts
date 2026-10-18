import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { CLIENT_TYPE_HEADER, IDEMPOTENCY_HEADER } from '@erp/shared';
import type { AppConfig } from './config/app-config';

/** Shared by main.ts and the integration tests so both run the same HTTP stack. */
export function setupApp(app: INestApplication, config: AppConfig): void {
  const express = app as NestExpressApplication;
  express.useLogger(app.get(Logger));
  // One proxy in front (load balancer) in production; needed for the client IP in audit logs.
  express.set('trust proxy', 1);
  express.use(cookieParser());
  express.enableCors({
    origin: config.WEB_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      IDEMPOTENCY_HEADER,
      CLIENT_TYPE_HEADER,
      'X-Request-Id',
    ],
    exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed'],
  });
  express.enableShutdownHooks();
}
