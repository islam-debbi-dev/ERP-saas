import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  type ClientSegmentDto,
  type CreateClientSegmentInput,
  createClientSegmentSchema,
  Feature,
  Permission,
  type UpdateClientSegmentInput,
  updateClientSegmentSchema,
} from '@erp/shared';
import { RequireFeature, RequirePermission } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ClientSegmentsService } from './client-segments.service';

/**
 * The company's own client segments (phase 37). The client form and the statistics read
 * them; the settings edit them.
 */
@Controller('client-segments')
@RequireFeature(Feature.DISTRIBUTION_STATS)
export class ClientSegmentsController {
  constructor(private readonly segments: ClientSegmentsService) {}

  @Get()
  @RequirePermission(Permission.CLIENTS_VIEW)
  list(@Query('archived') archived?: string): Promise<ClientSegmentDto[]> {
    return this.segments.list(archived === 'true');
  }

  @Post()
  @RequirePermission(Permission.SETTINGS_EDIT)
  create(
    @Body(new ZodValidationPipe(createClientSegmentSchema)) body: CreateClientSegmentInput,
  ): Promise<ClientSegmentDto> {
    return this.segments.create(body);
  }

  @Patch(':id')
  @RequirePermission(Permission.SETTINGS_EDIT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateClientSegmentSchema)) body: UpdateClientSegmentInput,
  ): Promise<ClientSegmentDto> {
    return this.segments.update(id, body);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.SETTINGS_EDIT)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.segments.archive(id);
  }
}
