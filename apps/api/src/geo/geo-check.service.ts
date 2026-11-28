import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  evaluateGeo,
  Feature,
  GeoCheckMode,
  type GeoCheckResultDto,
  type GeoErrorDetails,
  type GeoInput,
  type GeoReading,
  GeoRefType,
  GeoStatus,
  type LatLng,
  Permission,
  Role,
  FIELD_SELLER_ROLES,
} from '@erp/shared';
import { AuditService } from '../audit/audit.service';
import type { CurrentUserInfo } from '../auth/auth.types';
import { can } from '../auth/permissions';
import { FeaturesService } from '../billing/features.service';
import { ClientLocationService } from '../clients/client-location.service';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { type Tx } from '../prisma/prisma.service';

/**
 * Roles whose operations happen at the client's place. Office staff selling at the
 * counter are not checked (their position says nothing about the client).
 */
const FIELD_ROLES = new Set<string>([...FIELD_SELLER_ROLES, Role.LIVREUR]);

export interface GeoCheckRequest {
  refType: GeoRefType;
  refId: string;
  refNumber?: string | null;
  clientId: string | null;
  geo: GeoInput | undefined;
  user: CurrentUserInfo;
}

/**
 * The position check of a sale, versement or visit (phase 17, GEO_CHECK). Runs inside the
 * document's transaction, so a refused check (note missing, BLOCK mode) saves nothing,
 * and the row is written with the document or not at all. The API decides; the device
 * only sends raw data.
 */
@Injectable()
export class GeoCheckService {
  constructor(
    private readonly features: FeaturesService,
    private readonly locations: ClientLocationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * A self check-in or check-out (phase 31): the phase 17 rules against the dépôt's point,
   * one position per tap. The HR service has already decided the employee may check in,
   * so unlike `checkInTx` every role is checked. Same transaction, same refusal rules.
   */
  async checkAttendanceInTx(
    tx: Tx,
    req: {
      eventId: string;
      geo: GeoInput | undefined;
      user: CurrentUserInfo;
      point: LatLng | null;
      radiusM: number | null;
    },
  ): Promise<GeoCheckResultDto | null> {
    const tenantId = tenantContext.requireTenantId();
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { geoCheckMode: true, geoRadiusM: true, geoMaxAccuracyM: true },
    });
    if (tenant.geoCheckMode === GeoCheckMode.OFF) return null;
    return this.record(tx, {
      refType: GeoRefType.ATTENDANCE,
      refId: req.eventId,
      clientId: null,
      geo: req.geo,
      user: req.user,
      point: req.point,
      tenant: { ...tenant, geoRadiusM: req.radiusM ?? tenant.geoRadiusM },
    });
  }

  async checkInTx(tx: Tx, req: GeoCheckRequest): Promise<GeoCheckResultDto | null> {
    // The client comptoir has no point to compare with.
    if (!req.clientId || !FIELD_ROLES.has(req.user.role)) return null;
    const tenantId = tenantContext.requireTenantId();
    if (!(await this.features.of(tenantId)).features.includes(Feature.GEO_CHECK)) return null;
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { geoCheckMode: true, geoRadiusM: true, geoMaxAccuracyM: true },
    });
    if (tenant.geoCheckMode === GeoCheckMode.OFF) return null;
    const point = await this.locations.pointInTx(tx, req.clientId);
    return this.record(tx, { ...req, point, tenant });
  }

  private async record(
    tx: Tx,
    req: GeoCheckRequest & {
      point: LatLng | null;
      tenant: { geoCheckMode: string; geoRadiusM: number; geoMaxAccuracyM: number };
    },
  ): Promise<GeoCheckResultDto> {
    const { tenant, point: client } = req;
    const tenantId = tenantContext.requireTenantId();
    const reading = readingOf(req.geo);
    const receivedAt = new Date();
    const result = evaluateGeo({
      geo: reading,
      client,
      radiusM: tenant.geoRadiusM,
      maxAccuracyM: tenant.geoMaxAccuracyM,
      receivedAt,
    });
    const details: GeoErrorDetails = { status: result.status, distanceM: result.distanceM };

    if (tenant.geoCheckMode === GeoCheckMode.BLOCK && !can(req.user, Permission.GEO_OVERRIDE)) {
      if (result.status === GeoStatus.FAR) {
        throw new AppException(ErrorCode.GEO_TOO_FAR, 'Too far from the client', details);
      }
      if (result.status === GeoStatus.MOCKED) {
        throw new AppException(ErrorCode.GEO_MOCKED, 'Fake position detected', details);
      }
    }
    const note = req.geo?.note ?? null;
    if (result.noteRequired && !note) {
      throw new AppException(ErrorCode.GEO_NOTE_REQUIRED, 'A note is required', details);
    }

    const row = await tx.geoCheck.create({
      data: {
        tenantId,
        refType: req.refType,
        refId: req.refId,
        refNumber: req.refNumber ?? null,
        clientId: req.clientId,
        userId: req.user.id,
        lat: reading?.lat ?? null,
        lng: reading?.lng ?? null,
        accuracyM: reading ? Math.round(reading.accuracyM) : null,
        isMocked: reading?.isMocked ?? false,
        capturedAt: reading?.capturedAt ?? null,
        receivedAt,
        clientLat: client?.lat ?? null,
        clientLng: client?.lng ?? null,
        distanceM: result.distanceM,
        status: result.status,
        flags: result.flags,
        note,
      },
    });
    await this.audit.log(tx, {
      action: 'GEO_CHECKED',
      entity: 'GeoCheck',
      entityId: row.id,
      after: {
        refType: req.refType,
        refId: req.refId,
        status: result.status,
        distanceM: result.distanceM,
        flags: result.flags,
        mode: tenant.geoCheckMode,
      },
    });
    return {
      id: row.id,
      status: result.status,
      distanceM: result.distanceM,
      flags: result.flags,
      offerSaveClientLocation: result.status === GeoStatus.NO_CLIENT_GPS,
    };
  }
}

function readingOf(geo: GeoInput | undefined): GeoReading | null {
  if (
    !geo ||
    geo.lat === undefined ||
    geo.lng === undefined ||
    geo.accuracyM === undefined ||
    geo.capturedAt === undefined
  ) {
    return null;
  }
  return {
    lat: geo.lat,
    lng: geo.lng,
    accuracyM: geo.accuracyM,
    isMocked: geo.isMocked,
    capturedAt: new Date(geo.capturedAt),
  };
}
