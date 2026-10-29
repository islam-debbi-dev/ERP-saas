import { Injectable } from '@nestjs/common';

/**
 * The current time for date-driven business rules (subscription status). Tests replace
 * it to move time forward without touching the database or fake timers.
 */
@Injectable()
export class ClockService {
  now(): Date {
    return new Date();
  }
}
