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
} from '@nestjs/common';
import {
  type AdjustSellerSessionInput,
  adjustSellerSessionSchema,
  type AssignLivreurInput,
  assignLivreurSchema,
  type CancelOrderInput,
  cancelOrderSchema,
  type CloseSellerSessionInput,
  closeSellerSessionSchema,
  type CreateOrderInput,
  createOrderSchema,
  type CreateRouteInput,
  createRouteSchema,
  type CreateVisitInput,
  createVisitSchema,
  type DelivererDto,
  type DeliverOrderInput,
  type DeliverOrderResultDto,
  deliverOrderSchema,
  Feature,
  type OpenSellerSessionInput,
  openSellerSessionSchema,
  type OrderDto,
  type OrderListQuery,
  orderListQuerySchema,
  type OrderPage,
  Role,
  type RouteDto,
  type RouteListQuery,
  routeListQuerySchema,
  type SellerDayDto,
  type SellerSessionCloseResultDto,
  type SellerSessionDto,
  type SellerSessionListQuery,
  sellerSessionListQuerySchema,
  type SetRouteStopsInput,
  setRouteStopsSchema,
  type TodayDto,
  type TourneeReportDto,
  type TourneeReportQuery,
  tourneeReportQuerySchema,
  type UpdateOrderInput,
  updateOrderSchema,
  type UpdateRouteInput,
  updateRouteSchema,
  type VisitDto,
  type VisitListQuery,
  visitListQuerySchema,
  type VisitPage,
} from '@erp/shared';
import type { CurrentUserInfo } from '../auth/auth.types';
import { CurrentUser, RequireFeature, Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Idempotent } from '../idempotency/idempotent.decorator';
import { OrdersService } from './orders.service';
import { RoutesService } from './routes.service';
import { SellerSessionsService } from './seller-sessions.service';
import { PLANNERS } from './tournee-scope';
import { TourneeReportsService } from './tournee-reports.service';
import { VisitsService } from './visits.service';

/** Who sells: takes orders and records visits. */
const SELLERS = [...PLANNERS, Role.SELLER];
/** Who hands over the goods of an order. */
const DELIVERERS = [...SELLERS, Role.LIVREUR];

@Controller('routes')
@RequireFeature(Feature.TOURNEES)
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(routeListQuerySchema)) query: RouteListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<RouteDto[]> {
    return this.routes.list(query, user);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<RouteDto> {
    return this.routes.get(id, user);
  }

  @Post()
  @Roles(...PLANNERS)
  create(
    @Body(new ZodValidationPipe(createRouteSchema)) body: CreateRouteInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<RouteDto> {
    return this.routes.create(body, user);
  }

  @Patch(':id')
  @Roles(...PLANNERS)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRouteSchema)) body: UpdateRouteInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<RouteDto> {
    return this.routes.update(id, body, user);
  }

  @Put(':id/stops')
  @Roles(...PLANNERS)
  setStops(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setRouteStopsSchema)) body: SetRouteStopsInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<RouteDto> {
    return this.routes.setStops(id, body, user);
  }

  @Delete(':id')
  @Roles(...PLANNERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<void> {
    return this.routes.archive(id, user);
  }
}

@Controller('me')
@RequireFeature(Feature.TOURNEES)
export class MeTodayController {
  constructor(private readonly routes: RoutesService) {}

  /** The caller's tournée of today (Algiers weekday). */
  @Get('today')
  today(@CurrentUser() user: CurrentUserInfo): Promise<TodayDto> {
    return this.routes.today(user);
  }
}

@Controller('visits')
@RequireFeature(Feature.TOURNEES)
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(visitListQuerySchema)) query: VisitListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<VisitPage> {
    return this.visits.list(query, user);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<VisitDto> {
    return this.visits.get(id, user);
  }

  @Post()
  @Idempotent()
  @Roles(...SELLERS)
  create(
    @Body(new ZodValidationPipe(createVisitSchema)) body: CreateVisitInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<VisitDto> {
    return this.visits.create(body, user);
  }
}

@Controller('orders')
@RequireFeature(Feature.TOURNEES)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(orderListQuerySchema)) query: OrderListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<OrderPage> {
    return this.orders.list(query, user);
  }

  // Declared before ':id'.
  @Get('deliverers')
  @Roles(...PLANNERS)
  deliverers(): Promise<DelivererDto[]> {
    return this.orders.deliverers();
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<OrderDto> {
    return this.orders.get(id, user);
  }

  @Post()
  @Idempotent()
  @Roles(...SELLERS)
  create(
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<OrderDto> {
    return this.orders.create(body, user);
  }

  @Put(':id')
  @Roles(...SELLERS)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateOrderSchema)) body: UpdateOrderInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<OrderDto> {
    return this.orders.update(id, body, user);
  }

  @Post(':id/confirm')
  @Idempotent()
  @Roles(...SELLERS)
  @HttpCode(HttpStatus.OK)
  confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<OrderDto> {
    return this.orders.confirm(id, user);
  }

  @Post(':id/cancel')
  @Idempotent()
  @Roles(...SELLERS)
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cancelOrderSchema)) body: CancelOrderInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<OrderDto> {
    return this.orders.cancel(id, body.reason, user);
  }

  @Patch(':id/livreur')
  @Roles(...PLANNERS)
  assignLivreur(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(assignLivreurSchema)) body: AssignLivreurInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<OrderDto> {
    return this.orders.assignLivreur(id, body, user);
  }

  @Post(':id/deliver')
  @Idempotent()
  @Roles(...DELIVERERS)
  @HttpCode(HttpStatus.OK)
  deliver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(deliverOrderSchema)) body: DeliverOrderInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<DeliverOrderResultDto> {
    return this.orders.deliver(id, body, user);
  }
}

@Controller('seller-sessions')
@RequireFeature(Feature.TOURNEES)
@Roles(...PLANNERS)
export class SellerSessionsController {
  constructor(private readonly sessions: SellerSessionsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(sellerSessionListQuerySchema)) query: SellerSessionListQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SellerDayDto[]> {
    return this.sessions.listDay(query.date, user);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SellerSessionDto> {
    return this.sessions.get(id, user);
  }

  @Post()
  @Idempotent()
  open(
    @Body(new ZodValidationPipe(openSellerSessionSchema)) body: OpenSellerSessionInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SellerSessionDto> {
    return this.sessions.open(body, user);
  }

  @Post(':id/close')
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(closeSellerSessionSchema)) body: CloseSellerSessionInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SellerSessionCloseResultDto> {
    return this.sessions.close(id, body, user);
  }

  @Post(':id/adjust')
  @Idempotent()
  adjust(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(adjustSellerSessionSchema)) body: AdjustSellerSessionInput,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<SellerSessionDto> {
    return this.sessions.adjust(id, body, user);
  }
}

@Controller('tournees/reports')
@RequireFeature(Feature.TOURNEES)
@Roles(...SELLERS)
export class TourneeReportsController {
  constructor(private readonly reports: TourneeReportsService) {}

  @Get()
  report(
    @Query(new ZodValidationPipe(tourneeReportQuerySchema)) query: TourneeReportQuery,
    @CurrentUser() user: CurrentUserInfo,
  ): Promise<TourneeReportDto> {
    return this.reports.report(query, user);
  }
}
