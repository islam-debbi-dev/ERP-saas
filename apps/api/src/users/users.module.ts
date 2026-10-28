import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/** Staff accounts: invitations, roles, per-user permissions, deactivation. */
@Module({
  imports: [AuthModule, BillingModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
