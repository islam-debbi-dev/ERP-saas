import { Module } from '@nestjs/common';
import { HrCoreModule } from '../hr/hr-core.module';
import { ReconcileService } from './reconcile.service';

@Module({
  imports: [HrCoreModule],
  providers: [ReconcileService],
  exports: [ReconcileService],
})
export class ReconcileModule {}
