import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { tenantContext } from './tenant-context';

/** Opens an empty context per request; the auth guard fills it in. */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    tenantContext.run(
      {
        ip: req.ip ?? null,
        userAgent: req.get('user-agent')?.slice(0, 255) ?? null,
      },
      next,
    );
  }
}
