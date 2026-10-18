import { HttpException, HttpStatus } from '@nestjs/common';
import { type ApiError, ErrorCode } from '@erp/shared';

const STATUS_BY_CODE: Partial<Record<ErrorCode, HttpStatus>> = {
  [ErrorCode.VALIDATION_FAILED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.IDEMPOTENCY_KEY_REQUIRED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.CONFLICT]: HttpStatus.CONFLICT,
  [ErrorCode.EMAIL_ALREADY_USED]: HttpStatus.CONFLICT,
  [ErrorCode.IDEMPOTENCY_KEY_REUSED]: HttpStatus.CONFLICT,
  [ErrorCode.IDEMPOTENCY_REQUEST_IN_PROGRESS]: HttpStatus.CONFLICT,
  [ErrorCode.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [ErrorCode.TOO_MANY_REQUESTS]: HttpStatus.TOO_MANY_REQUESTS,
  [ErrorCode.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.INVALID_CREDENTIALS]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.TOKEN_EXPIRED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.INVALID_TOKEN]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.SESSION_REVOKED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.SESSION_EXPIRED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.REFRESH_TOKEN_REUSED]: HttpStatus.UNAUTHORIZED,
  [ErrorCode.DB_UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
};

/** The only exception business code throws. The global filter renders `{ code, message, details? }`. */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    status?: HttpStatus,
  ) {
    const body: ApiError = details === undefined ? { code, message } : { code, message, details };
    super(body, status ?? STATUS_BY_CODE[code] ?? HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
