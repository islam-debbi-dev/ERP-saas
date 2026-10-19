import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { Response } from 'express';
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

/** Renders every error as `{ code, message, details? }` and reports unexpected ones to Sentry. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.toResponse(exception);
    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
      Sentry.captureException(exception);
    }
    res.status(status).json(body);
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
    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === 'P2002') {
      return [
        HttpStatus.CONFLICT,
        { code: ErrorCode.CONFLICT, message: 'Unique constraint violated' },
      ];
    }
    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      { code: ErrorCode.INTERNAL_ERROR, message: 'Internal server error' },
    ];
  }
}
