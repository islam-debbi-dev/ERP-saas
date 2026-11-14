import type { NextFunction, Request, Response } from 'express';
import { ErrorCode } from '@erp/shared';
import { AppException } from './app-exception';

/** A high surrogate with no low one after it, or a low one with no high one before it. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * True when a JSON value holds a string, or a key, that is not well-formed Unicode. JSON can
 * carry one (`"\ud800"`); UTF-8 cannot, and PostgreSQL refuses it in text and in jsonb.
 */
export function hasIllFormedText(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return LONE_SURROGATE.test(value);
  if (value === null || typeof value !== 'object' || depth > 32) return false;
  if (Array.isArray(value)) return value.some((v) => hasIllFormedText(v, depth + 1));
  return Object.entries(value).some(
    ([key, v]) => LONE_SURROGATE.test(key) || hasIllFormedText(v, depth + 1),
  );
}

/**
 * Audit 02, B-4: a name holding a lone surrogate passed every schema (it is a string of the
 * right length) and came back from the database as a 500, on every route with a text field.
 * Refused here once, for every body, before any schema: 400.
 */
export function rejectIllFormedText(req: Request, _res: Response, next: NextFunction): void {
  if (hasIllFormedText(req.body)) {
    next(
      new AppException(ErrorCode.VALIDATION_FAILED, 'Invalid characters in the request', {
        rule: 'ill_formed_text',
      }),
    );
    return;
  }
  next();
}
