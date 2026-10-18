import { type PipeTransform } from '@nestjs/common';
import { type z } from 'zod';
import { ErrorCode } from '@erp/shared';
import { AppException } from './app-exception';

/** Validates and parses a body/query with a zod schema from @erp/shared. */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Invalid input', {
        issues: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          code: i.code,
          message: i.message,
        })),
      });
    }
    return result.data;
  }
}
