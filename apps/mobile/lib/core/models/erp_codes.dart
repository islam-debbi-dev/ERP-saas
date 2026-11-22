/// Names the API uses for roles, modules and permissions, kept as the API's
/// strings (`packages/shared/src/{enums,features,permissions}.ts`). The app
/// only reads them to hide what the user cannot do; the API enforces them.
class Role {
  Role._();

  static const owner = 'OWNER';
  static const manager = 'MANAGER';
  static const seller = 'SELLER';
  static const storekeeper = 'STOREKEEPER';
  static const supervisor = 'SUPERVISOR';
  static const livreur = 'LIVREUR';

  /// Roles that use the phone app. Owners and managers use the web dashboard.
  static const fieldRoles = {seller, livreur, supervisor, storekeeper};

  /// Field roles that take bons de commande (`POST /orders` is for SELLERS
  /// and the planners in tournees.controllers.ts); a livreur only delivers.
  static const orderTakers = {seller, supervisor};

  static const officeRoles = {owner, manager};
}

/// Modules of the tenant's edition (`Feature` in features.ts).
class Feature {
  Feature._();

  static const mobileApp = 'MOBILE_APP';
  static const salesForce = 'SALES_FORCE';
  static const warehouses = 'WAREHOUSES';
  static const tournees = 'TOURNEES';
  static const geoCheck = 'GEO_CHECK';
  static const incentives = 'INCENTIVES';
  static const promotions = 'PROMOTIONS';
  static const packaging = 'PACKAGING';
  static const multiUnit = 'MULTI_UNIT';
  static const aiAssistant = 'AI_ASSISTANT';
}

/// Rights of a user (`Permission` in permissions.ts): role defaults plus
/// grants minus revokes, as `GET /auth/me` returns them.
class Permission {
  Permission._();

  static const priceOverride = 'PRICE_OVERRIDE';
  static const discountAboveX = 'DISCOUNT_ABOVE_X';
  static const creditOverride = 'CREDIT_OVERRIDE';
  static const stockAdjust = 'STOCK_ADJUST';
  static const viewCostAndMargin = 'VIEW_COST_AND_MARGIN';
  static const geoOverride = 'GEO_OVERRIDE';
  static const promoOverride = 'PROMO_OVERRIDE';
  static const stockCount = 'STOCK_COUNT';
  static const stockTransfer = 'STOCK_TRANSFER';
  static const clientsCreate = 'CLIENTS_CREATE';
  static const clientsEdit = 'CLIENTS_EDIT';
  static const salesCreate = 'SALES_CREATE';
  static const paymentsCreate = 'PAYMENTS_CREATE';
  static const purchasesCreate = 'PURCHASES_CREATE';
  static const useAssistant = 'USE_ASSISTANT';
}
