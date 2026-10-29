import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  type CreateSectorInput,
  createSectorSchema,
  Feature,
  Role,
  type SectorDto,
  type UpdateSectorInput,
  updateSectorSchema,
} from '@erp/shared';
import { RequireFeature, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SectorsService } from './sectors.service';

const MANAGERS = [Role.OWNER, Role.MANAGER];

@Controller('sectors')
@RequireFeature(Feature.SALES_FORCE)
export class SectorsController {
  constructor(private readonly sectors: SectorsService) {}

  @Get()
  list(): Promise<SectorDto[]> {
    return this.sectors.list();
  }

  @Post()
  @Roles(...MANAGERS)
  create(
    @Body(new ZodValidationPipe(createSectorSchema)) body: CreateSectorInput,
  ): Promise<SectorDto> {
    return this.sectors.create(body);
  }

  @Patch(':id')
  @Roles(...MANAGERS)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSectorSchema)) body: UpdateSectorInput,
  ): Promise<SectorDto> {
    return this.sectors.update(id, body);
  }

  @Delete(':id')
  @Roles(...MANAGERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.sectors.archive(id);
  }
}
