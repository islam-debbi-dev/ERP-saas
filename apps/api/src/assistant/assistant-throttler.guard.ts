import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';

export const ASSISTANT_THROTTLER = 'assistant';

/** Set on the request by the guard below; the `assistant` throttler is off without it. */
export const ASSISTANT_THROTTLE_FLAG = 'assistantThrottle';

/**
 * 10 questions a minute per user. The global ThrottlerGuard runs before the JWT guard, so
 * it cannot know the user: the `assistant` throttler is skipped there and counted here,
 * on the route, after authentication.
 */
@Injectable()
export class AssistantThrottlerGuard extends ThrottlerGuard {
  override canActivate(context: ExecutionContext): Promise<boolean> {
    context.switchToHttp().getRequest<Record<string, unknown>>()[ASSISTANT_THROTTLE_FLAG] = true;
    return super.canActivate(context);
  }

  protected override handleRequest(props: ThrottlerRequest): Promise<boolean> {
    if (props.throttler.name !== ASSISTANT_THROTTLER) return Promise.resolve(true);
    return super.handleRequest(props);
  }
}
