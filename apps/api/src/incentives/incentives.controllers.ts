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
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  type BulkTargets,
  bulkTargetsSchema,
  type CreatePlanInput,
  createPlanSchema,
  Feature,
  type IncentivePlanDto,
  type IncentiveRunDetailDto,
  type IncentiveRunDto,
  type MyObjectivesDto,
  type NewPlanVersionInput,
  newPlanVersionSchema,
  type ParsedRuleInput,
  type PreviewRunInput,
  previewRunSchema,
  ruleInputSchema,
  type RunListQuery,
  runListQuerySchema,
  type SalesTargetDto,
  type SalesTargetQuery,
  salesTargetQuerySchema,
  type UpdatePlanInput,
  updatePlanSchema,
  TEAM_LEAD_ROLES,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MANAGERS } from './incentive-common';
import { ObjectivesService } from './objectives.service';
import { PlansService } from './plans.service';
import { buildRunXlsx, runFileName } from './run-xlsx';
import { RunsService } from './runs.service';
import { TargetsService } from './targets.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('sales-targets')
@RequireFeature(Feature.INCENTIVES)
export class SalesTargetsController {
  constructor(private readonly targets: TargetsService) {}

  /** A supervisor reads his team's targets; managers set them. */
  @Get()
  @Roles(...MANAGERS, ...TEAM_LEAD_ROLES)
  list(
    @Query(new ZodValidationPipe(salesTargetQuerySchema)) query: SalesTargetQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SalesTargetDto[]> {
    return this.targets.list(query, user);
  }

  @Put('bulk')
  @Roles(...MANAGERS)
  bulk(
    @Body(new ZodValidationPipe(bulkTargetsSchema)) body: BulkTargets,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SalesTargetDto[]> {
    return this.targets.bulk(body, user);
  }
}

@Controller('incentive-plans')
@RequireFeature(Feature.INCENTIVES)
@Roles(...MANAGERS)
export class IncentivePlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  list(): Promise<IncentivePlanDto[]> {
    return this.plans.list();
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createPlanSchema)) body: CreatePlanInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<IncentivePlanDto> {
    return this.plans.create(body, user);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<IncentivePlanDto> {
    return this.plans.get(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePlanSchema)) body: UpdatePlanInput,
  ): Promise<IncentivePlanDto> {
    return this.plans.update(id, body);
  }

  @Post(':id/rules')
  addRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ruleInputSchema)) body: ParsedRuleInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<IncentivePlanDto> {
    return this.plans.addRule(id, body, user);
  }

  @Put(':id/rules/:ruleId')
  updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body(new ZodValidationPipe(ruleInputSchema)) body: ParsedRuleInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<IncentivePlanDto> {
    return this.plans.updateRule(id, ruleId, body, user);
  }

  @Delete(':id/rules/:ruleId')
  removeRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
  ): Promise<IncentivePlanDto> {
    return this.plans.removeRule(id, ruleId);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id', ParseUUIDPipe) id: string): Promise<IncentivePlanDto> {
    return this.plans.activate(id);
  }

  @Post(':id/new-version')
  newVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(newPlanVersionSchema)) body: NewPlanVersionInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<IncentivePlanDto> {
    return this.plans.newVersion(id, body, user);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<IncentivePlanDto> {
    return this.plans.archive(id);
  }
}

@Controller('incentive-runs')
@RequireFeature(Feature.INCENTIVES)
@Roles(...MANAGERS)
export class IncentiveRunsController {
  constructor(private readonly runs: RunsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(runListQuerySchema)) query: RunListQuery,
  ): Promise<IncentiveRunDto[]> {
    return this.runs.list(query);
  }

  /** Computes (or recomputes) the preview of a plan for a period. */
  @Post()
  @HttpCode(HttpStatus.OK)
  preview(
    @Body(new ZodValidationPipe(previewRunSchema)) body: PreviewRunInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<IncentiveRunDetailDto> {
    return this.runs.preview(body, user);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<IncentiveRunDetailDto> {
    return this.runs.get(id, user);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<IncentiveRunDetailDto> {
    return this.runs.approve(id, user);
  }

  @Get(':id/export.xlsx')
  async export(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<StreamableFile> {
    const run = await this.runs.exportRun(id, user);
    const buffer = await buildRunXlsx(run);
    return new StreamableFile(buffer, {
      type: XLSX_MIME,
      disposition: `attachment; filename="${runFileName(run)}"`,
      length: buffer.length,
    });
  }
}

@Controller('me/objectives')
@RequireFeature(Feature.INCENTIVES)
export class MyObjectivesController {
  constructor(private readonly objectives: ObjectivesService) {}

  /** Anyone sees his own targets (a supervisor his team's too). */
  @Get()
  mine(@CurrentUser() user: CurrentUserInfo): Promise<MyObjectivesDto> {
    return this.objectives.mine(user);
  }
}
