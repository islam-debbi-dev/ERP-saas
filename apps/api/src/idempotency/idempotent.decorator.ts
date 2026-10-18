import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'erp:idempotent';

/**
 * Marks a POST route as idempotent (AGENTS.md rule 6): the client must send an
 * `Idempotency-Key` header; a replay returns the stored response and creates nothing.
 * Use on every route that creates money or stock effects. The route must be authenticated.
 */
export const Idempotent = (): MethodDecorator & ClassDecorator => SetMetadata(IDEMPOTENT_KEY, true);
