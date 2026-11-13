import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Request, Response } from 'express';
import { type ApiError, ErrorCode } from '@erp/shared';
import { Prisma } from '../generated/prisma/client';
import { AppException } from './app-exception';

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: ErrorCode.VALIDATION_FAILED,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  413: ErrorCode.IMPORT_FILE_TOO_LARGE,
  429: ErrorCode.TOO_MANY_REQUESTS,
};

function isClientHttpError(e: unknown): e is { status: number; message: string } {
  if (typeof e !== 'object' || e === null) return false;
  const { status, expose } = e as { status?: unknown; expose?: unknown };
  return expose === true && typeof status === 'number' && status >= 400 && status < 500;
}

/**
 * PostgreSQL refused a text value for its bytes (SQLSTATE 22021, in practice a NUL): the
 * input was bad, the server is fine. Prisma reports it under several shapes depending on
 * the query (raw or not) and on the driver, so the cause chain is read too.
 */
export function isInvalidTextError(e: unknown): boolean {
  for (let cur = e, depth = 0; depth < 5 && typeof cur === 'object' && cur !== null; depth++) {
    const { code, meta, message, cause } = cur as {
      code?: unknown;
      meta?: { code?: unknown } | null;
      message?: unknown;
      cause?: unknown;
    };
    if (code === '22021' || meta?.code === '22021') return true;
    if (typeof message === 'string' && /invalid byte sequence for encoding/i.test(message)) {
      return true;
    }
    cur = cause;
  }
  return false;
}

/** Renders every error as `{ code, message, details? }` and reports unexpected ones to Sentry. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    // Set by pino-http from X-Request-Id (or generated): the same id as the log lines,
    // so a user can read it out from an error toast and we find the request.
    const requestId =
      (http.getRequest<Request & { id?: unknown }>().id as string | undefined) ?? undefined;
    const [status, body] = this.toResponse(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      Sentry.withScope((scope) => {
        if (requestId) scope.setTag('request_id', requestId);
        Sentry.captureException(exception);
      });
    }
    res.status(status).json(requestId ? { ...body, requestId } : body);
  }

  private toResponse(exception: unknown): [number, ApiError] {
    if (exception instanceof AppException) {
      return [exception.getStatus(), exception.getResponse() as ApiError];
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return [
        status,
        { code: CODE_BY_STATUS[status] ?? ErrorCode.INTERNAL_ERROR, message: exception.message },
      ];
    }
    // body-parser errors (http-errors): malformed JSON, body over the size limit.
    if (isClientHttpError(exception)) {
      return exception.status === 413
        ? [413, { code: ErrorCode.PAYLOAD_TOO_LARGE, message: 'Request body too large' }]
        : [
            exception.status,
            {
              code: CODE_BY_STATUS[exception.status] ?? ErrorCode.VALIDATION_FAILED,
              message: exception.message,
            },
          ];
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      return [
        HttpStatus.CONFLICT,
        { code: ErrorCode.CONFLICT, message: 'Unique constraint violated' },
      ];
    }
    // A net under the schemas: a field that let a NUL byte through is a 400, not a page.
    if (isInvalidTextError(exception)) {
      return [
        HttpStatus.BAD_REQUEST,
        { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid characters in the request' },
      ];
    }
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      { code: ErrorCode.INTERNAL_ERROR, message: 'Internal server error' },
    ];
  }
}
