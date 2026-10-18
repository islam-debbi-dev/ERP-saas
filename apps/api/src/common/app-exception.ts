import { HttpException, HttpStatus } from '@nestjs/common';
import { type ApiError, ErrorCode } from '@erp/shared';

/** Exhaustive: adding an ErrorCode without a status is a type error. */
const STATUS_BY_CODE: Record<ErrorCode, HttpStatus> = {
  [ErrorCode.VALIDATION_FAILED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.IDEMPOTENCY_KEY_REQUIRED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.INVALID_PRODUCT_UNITS]: HttpStatus.BAD_REQUEST,
  [ErrorCode.CATEGORY_TOO_DEEP]: HttpStatus.BAD_REQUEST,
  [ErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.PRODUCT_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.CONFLICT]: HttpStatus.CONFLICT,
  [ErrorCode.EMAIL_ALREADY_USED]: HttpStatus.CONFLICT,
  [ErrorCode.IDEMPOTENCY_KEY_REUSED]: HttpStatus.CONFLICT,
  [ErrorCode.IDEMPOTENCY_REQUEST_IN_PROGRESS]: HttpStatus.CONFLICT,
  [ErrorCode.PRODUCT_MODIFIED]: HttpStatus.CONFLICT,
  [ErrorCode.REFERENCE_ALREADY_USED]: HttpStatus.CONFLICT,
  [ErrorCode.BARCODE_ALREADY_USED]: HttpStatus.CONFLICT,
  [ErrorCode.CATEGORY_NAME_TAKEN]: HttpStatus.CONFLICT,
  [ErrorCode.CATEGORY_NOT_EMPTY]: HttpStatus.CONFLICT,
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
  [ErrorCode.INTERNAL_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
  [ErrorCode.TENANT_CONTEXT_MISSING]: HttpStatus.INTERNAL_SERVER_ERROR,
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
    super(body, status ?? STATUS_BY_CODE[code]);
  }
}
