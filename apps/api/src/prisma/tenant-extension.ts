import { ErrorCode } from '@erp/shared';
import { AppException } from '../common/app-exception';
import { tenantContext } from '../common/tenant-context';
import { Prisma } from '../generated/prisma/client';

/** Models that carry a tenantId column. Every new business model must be added here. */
export const TENANT_SCOPED_MODELS = new Set<string>([
  'User',
  'UserInvitation',
  'Session',
  'AuditLog',
  'DocumentSequence',
  'IdempotencyKey',
  'Category',
  'Unit',
  'PriceLevel',
  'Product',
  'ProductUnit',
  'ProductPrice',
  'ProductStock',
  'StockMovement',
  'Inventory',
  'InventoryLine',
  'Supplier',
  'Purchase',
  'PurchaseLine',
  'PurchaseReturn',
  'PurchaseReturnLine',
  'Client',
  'ClientLedgerEntry',
  'ClientBalance',
  'AiProviderConfig',
  'AssistantConversation',
  'AssistantMessage',
  'PayItemType',
  'EmployeePayItem',
  'PayrollRateSet',
  'PayrollRateConfirmation',
  'PayrollRun',
  'Payslip',
  'PayslipLine',
  'PayrollManualLine',
  'Sale',
  'SaleLine',
  'SaleReturn',
  'SaleReturnLine',
  'Payment',
  'PaymentAllocation',
  'DocumentPrint',
  'ImportJob',
  'Subscription',
  'SubscriptionPayment',
  'SupplierLedgerEntry',
  'SupplierBalance',
  'SupplierPayment',
  'ShareLink',
  'Brand',
  'Sector',
  'Warehouse',
  'WarehouseStock',
  'StockTransfer',
  'StockTransferLine',
  'Route',
  'RouteStop',
  'Visit',
  'Order',
  'OrderLine',
  'SellerSession',
  'GeoCheck',
  'GeoCheckReview',
  'ClientGeoChangeRequest',
  'SalesTarget',
  'IncentivePlan',
  'IncentiveRule',
  'IncentiveRun',
  'IncentiveLine',
  'Promotion',
  'PromotionProduct',
  'PromotionClient',
  'PackagingType',
  'ProductPackaging',
  'ClientPackagingEntry',
  'ClientPackagingBalance',
  'UserWarehouseAccess',
  'WarehouseBrand',
  'WarehouseCategory',
  'ExpenseCategory',
  'RentContract',
  'Expense',
  'Employee',
  'EmployeeSalary',
  'EmployeeBalance',
  'EmployeeLedgerEntry',
  'AttendanceEvent',
  'AttendanceDay',
  'AttendanceMonthLock',
  'PublicHoliday',
  'LeaveRequest',
  'LeaveEntry',
  'ImportFile',
  'ImportCost',
  'ImportCostAllocation',
]);

/** Append-only models: any update or delete is a bug (AGENTS.md rules 1 and 7). */
const APPEND_ONLY_MODELS = new Set<string>([
  'AuditLog',
  'StockMovement',
  'ClientLedgerEntry',
  'SupplierLedgerEntry',
  'DocumentPrint',
  'SubscriptionPayment',
  'PlatformAuditLog',
  'Visit',
  'GeoCheckReview',
  'ClientPackagingEntry',
  'PayrollRateSet',
  'PayrollRateConfirmation',
]);

/** Rows with a null tenantId belong to the platform: every company reads them. */
const SHARED_READ_MODELS = new Set<string>(['PayrollRateSet']);

const WHERE_OPERATIONS = new Set<string>([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

const MUTATING_OPERATIONS = new Set<string>([
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

type Args = Record<string, unknown> & {
  where?: Record<string, unknown>;
  data?: unknown;
  create?: Record<string, unknown>;
};

/**
 * Enforces tenant isolation in one place (AGENTS.md rule 5):
 * - reads, updates and deletes get `tenantId = <context tenant>` added to their `where`;
 * - creates get `tenantId` set (overriding any value passed in);
 * - the Tenant model itself is limited to the context tenant's row;
 * - with no tenant in context, every query on these models throws (fail closed),
 *   unless the code runs inside `tenantContext.runAsSystem()`.
 *
 * Limits: nested writes into another tenant-scoped model and raw SQL are not
 * rewritten. Write them as separate top-level calls, and pass tenantId explicitly in
 * raw SQL (see DocumentNumberingService).
 */
export const tenantExtension = Prisma.defineExtension({
  name: 'tenant-isolation',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (APPEND_ONLY_MODELS.has(model) && MUTATING_OPERATIONS.has(operation)) {
          throw new Error(`${model} is append-only: ${operation} is not allowed`);
        }

        const isTenantModel = model === 'Tenant';
        if (!isTenantModel && !TENANT_SCOPED_MODELS.has(model)) return query(args);

        const ctx = tenantContext.get();
        if (ctx?.system) return query(args);

        const tenantId = ctx?.tenantId;
        if (!tenantId) {
          throw new AppException(
            ErrorCode.TENANT_CONTEXT_MISSING,
            `Query on ${model}.${operation} without a tenant in context`,
          );
        }

        const a = args as Args;
        const scopeKey = isTenantModel ? 'id' : 'tenantId';

        if (WHERE_OPERATIONS.has(operation)) {
          a.where = SHARED_READ_MODELS.has(model)
            ? {
                ...a.where,
                AND: [
                  ...[a.where?.['AND'] ?? []].flat(),
                  { OR: [{ tenantId }, { tenantId: null }] },
                ],
              }
            : { ...a.where, [scopeKey]: tenantId };
        }

        if (isTenantModel) {
          if (operation.startsWith('create') || operation === 'upsert') {
            throw new Error('Tenants can only be created by the system context (registration)');
          }
          return query(a);
        }

        switch (operation) {
          case 'create':
            a.data = { ...(a.data as Record<string, unknown>), tenantId };
            break;
          case 'createMany':
          case 'createManyAndReturn': {
            const rows = Array.isArray(a.data) ? a.data : [a.data];
            a.data = rows.map((row: Record<string, unknown>) => ({ ...row, tenantId }));
            break;
          }
          case 'upsert':
            a.create = { ...a.create, tenantId };
            break;
          default:
            break;
        }
        return query(a);
      },
    },
  },
});
