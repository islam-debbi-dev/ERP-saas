import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { catchError, from, mergeMap, type Observable, of, switchMap } from 'rxjs';
import { ErrorCode } from '@erp/shared';
import { AppException } from '../common/app-exception';
import { IDEMPOTENT_KEY } from './idempotent.decorator';
import { IdempotencyService, requestHash } from './idempotency.service';

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,100}$/;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotency: IdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const enabled = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!enabled) return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const key = req.get('idempotency-key');
    if (!key || !KEY_PATTERN.test(key)) {
      throw new AppException(
        ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'Idempotency-Key header is required (8 to 100 characters: letters, digits, - _ : .)',
      );
    }

    const path = req.originalUrl.split('?')[0] ?? req.originalUrl;
    const hash = requestHash(req.method, path, req.body);
    const successStatus =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ??
      (req.method === 'POST' ? 201 : 200);

    return from(this.idempotency.begin(key, req.method, path, hash)).pipe(
      switchMap((begin) => {
        if (begin.kind === 'replay') {
          res.status(begin.status);
          res.setHeader('Idempotent-Replayed', 'true');
          return of(begin.body);
        }
        return next.handle().pipe(
          mergeMap(async (body: unknown) => {
            // Store exactly what the client receives (Decimal → string, Date → ISO).
            const stored: unknown = body === undefined ? null : JSON.parse(JSON.stringify(body));
            await this.idempotency.complete(begin.id, successStatus, stored);
            return body;
          }),
          catchError(async (err: unknown) => {
            await this.idempotency.release(begin.id);
            throw err;
          }),
        );
      }),
    );
  }
}
