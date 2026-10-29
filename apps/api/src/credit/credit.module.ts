import { Module } from '@nestjs/common';
import { AgingService } from './aging.service';

/**
 * Crédit avancé reads (phase 21): balance âgée, clients à relancer, cheques à échéance.
 * Read-only; the accounts themselves stay with the clients and purchases modules.
 */
@Module({
  providers: [AgingService],
  exports: [AgingService],
})
export class CreditModule {}
