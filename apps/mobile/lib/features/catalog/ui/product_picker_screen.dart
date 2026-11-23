import 'package:decimal/decimal.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/widgets/list_skeleton.dart';
import '../../../core/components/widgets/search_input.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/helpers/money.dart';
import '../../../core/localization/tr.dart';
import '../../../core/models/product_unit.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/paging/paged_cubit.dart';
import '../../sales/logic/sale_basket_cubit.dart';
import '../../sales/ui/widgets/basket_bar.dart';
import '../../sales/ui/widgets/qty_stepper.dart';
import '../data/models/product.dart';
import '../data/repo/catalog_repository.dart';
import 'barcode_scan_screen.dart';

/// Where picked products go: the sale basket (M1), a chargement, an
/// inventory count. Quantities only: a target never needs a price.
abstract class PickTarget {
  /// Base quantity of [productId] already taken (shown stock = stock − it).
  Decimal takenBase(String productId);

  void add(Product product, ProductUnit unit, Decimal qty);

  /// The sheet's button ("Ajouter au panier", "Ajouter").
  String get addLabelKey;

  /// The bar under the list; [done] goes back to the form.
  Widget bottomBar(BuildContext context, VoidCallback done);
}

/// M1's target: the [SaleBasketCubit] above the picker.
class SaleBasketPickTarget implements PickTarget {
  SaleBasketPickTarget(this.basket);

  final SaleBasketCubit basket;

  @override
  Decimal takenBase(String productId) => basket.state.lines
      .where((l) => l.product.id == productId)
      .fold(Decimal.zero, (sum, l) => sum + l.qtyBase);

  @override
  void add(Product product, ProductUnit unit, Decimal qty) =>
      basket.add(product, unit, qty);

  @override
  String get addLabelKey => 'sale.add_to_basket';

  @override
  Widget bottomBar(BuildContext context, VoidCallback done) =>
      BlocBuilder<SaleBasketCubit, SaleBasketState>(
        bloc: basket,
        builder: (context, s) => BasketBar(
          count: s.lineCount,
          total: s.pricing ? null : s.estimatedTtc,
          label: context.tr('sale.view_basket'),
          onTap: done,
        ),
      );
}

/// Picks products: search, barcode scan, unit (cartons / pièces), and what
/// is left in [warehouseId]. Works on [target], or on the
/// [SaleBasketCubit] above it (the sale basket).
class ProductPickerScreen extends StatefulWidget {
  const ProductPickerScreen({
    super.key,
    this.warehouseId,
    this.target,
    this.stockLabelKey = 'catalog.on_truck',
    this.showStock = true,
  });

  /// The dépôt or truck whose products and stock are shown.
  final String? warehouseId;
  final PickTarget? target;

  /// "Camion : {qty}" or "Dépôt : {qty}".
  final String stockLabelKey;

  /// False for a blind count: the stock is not shown.
  final bool showStock;

  @override
  State<ProductPickerScreen> createState() => _ProductPickerScreenState();
}

class _ProductPickerScreenState extends State<ProductPickerScreen> {
  final _repo = getIt<CatalogRepository>();
  late final PagedCubit<Product> _products = PagedCubit<Product>(
    (cursor) => _repo.products(warehouseId: widget.warehouseId, cursor: cursor),
  )..refresh();
  Map<String, Decimal>? _stock;
  late final PickTarget _target =
      widget.target ?? SaleBasketPickTarget(context.read<SaleBasketCubit>());

  @override
  void initState() {
    super.initState();
    final truck = widget.warehouseId;
    if (truck != null && widget.showStock) {
      _repo.stockOf(truck).then((r) {
        if (mounted && r is Success<Map<String, Decimal>>) {
          setState(() => _stock = r.data);
        }
      });
    }
  }

  @override
  void dispose() {
    _products.close();
    super.dispose();
  }

  void _search(String text) => _products.reset(
    (cursor) => _repo.products(
      search: text,
      warehouseId: widget.warehouseId,
      cursor: cursor,
    ),
  );

  Future<void> _scan() async {
    final messenger = ScaffoldMessenger.of(context);
    final code = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const BarcodeScanScreen()),
    );
    if (code == null || !mounted) return;
    final result = await _repo.byBarcode(code);
    if (!mounted) return;
    switch (result) {
      case Success(:final data):
        await _openAdd(data.product, unit: data.unit);
      case Failure(:final error):
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              error.code == 'NOT_FOUND'
                  ? context.tr('catalog.barcode_unknown', args: {'code': code})
                  : apiErrorText(context, error),
            ),
          ),
        );
    }
  }

  /// Base quantity still on the truck once the basket's lines are taken.
  Decimal? _left(Product p) {
    final stock = _stock?[p.id];
    if (stock == null) return _stock == null ? null : Decimal.zero;
    return stock - _target.takenBase(p.id);
  }

  Future<void> _openAdd(Product product, {ProductUnit? unit}) async {
    final picked = await showModalBottomSheet<(ProductUnit, Decimal)>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => AddProductSheet(
        product: product,
        initialUnit: unit,
        leftBase: _left(product),
        stockLabelKey: widget.stockLabelKey,
        actionLabelKey: _target.addLabelKey,
      ),
    );
    if (picked == null || !mounted) return;
    _target.add(product, picked.$1, picked.$2);
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(context.tr('catalog.pick_title')),
        actions: [
          IconButton(
            tooltip: context.tr('catalog.scan'),
            onPressed: _scan,
            icon: const Icon(Icons.qr_code_scanner),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.sm,
              AppSpacing.lg,
              AppSpacing.sm,
            ),
            child: SearchInput(
              hint: context.tr('catalog.search_hint'),
              onChanged: _search,
            ),
          ),
          Expanded(
            child: BlocBuilder<PagedCubit<Product>, PagedState<Product>>(
              bloc: _products,
              builder: (context, state) {
                if (state.isFirstLoad) return const ListSkeleton();
                if (state.status == PagedStatus.failure &&
                    state.items.isEmpty) {
                  return AppErrorState(
                    title: context.tr('common.load_failed'),
                    message: state.error == null
                        ? null
                        : apiErrorText(context, state.error!),
                    retryLabel: context.tr('common.retry'),
                    onRetry: _products.refresh,
                  );
                }
                if (state.isEmpty) {
                  return AppEmptyState(
                    icon: Icons.inventory_2_outlined,
                    title: context.tr('catalog.empty'),
                  );
                }
                return NotificationListener<ScrollNotification>(
                  onNotification: (n) {
                    if (n.metrics.extentAfter < 400) _products.loadMore();
                    return false;
                  },
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.lg,
                      AppSpacing.sm,
                      AppSpacing.lg,
                      BasketBar.clearance + AppSpacing.lg,
                    ),
                    itemCount: state.items.length,
                    separatorBuilder: (_, _) => AppSpacing.gapSm,
                    itemBuilder: (context, i) {
                      final p = state.items[i];
                      return ProductRow(
                        product: p,
                        leftBase: _left(p),
                        stockLabelKey: widget.stockLabelKey,
                        onTap: () => _openAdd(p),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: _target.bottomBar(context, () => Navigator.of(context).pop()),
      ),
    );
  }
}

/// A product row of the picker (adapted from the consumer product card):
/// designation, reference · brand, and what is left on the truck.
class ProductRow extends StatelessWidget {
  const ProductRow({
    super.key,
    required this.product,
    required this.onTap,
    this.leftBase,
    this.stockLabelKey = 'catalog.on_truck',
  });

  final Product product;
  final VoidCallback onTap;
  final String stockLabelKey;

  /// Base quantity left on the truck; null = not known.
  final Decimal? leftBase;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final unit = product.defaultSaleUnit;
    final left = leftBase;
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  product.designation,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: text.titleSmall,
                ),
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  [
                    product.reference,
                    if (product.brandName != null) product.brandName!,
                  ].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.bodySmall?.copyWith(color: context.textMuted),
                ),
                if (left != null && unit != null) ...[
                  const SizedBox(height: AppSpacing.xxs),
                  StockLabel(
                    leftBase: left,
                    product: product,
                    labelKey: stockLabelKey,
                  ),
                ],
              ],
            ),
          ),
          AppSpacing.gapSm,
          Icon(
            Icons.add_circle_outline,
            color: Theme.of(context).colorScheme.primary,
          ),
        ],
      ),
    );
  }
}

/// "Camion : 12 cartons + 5 pièces" (largest unit first), in red at zero.
class StockLabel extends StatelessWidget {
  const StockLabel({
    super.key,
    required this.leftBase,
    required this.product,
    this.labelKey = 'catalog.on_truck',
  });

  final Decimal leftBase;
  final Product product;

  /// "Camion : {qty}", "Dépôt : {qty}", "Disponible : {qty}".
  final String labelKey;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final empty = leftBase <= Decimal.zero;
    return Text(
      context.tr(labelKey, args: {'qty': stockText(product, leftBase)}),
      style: text.bodySmall?.copyWith(
        color: empty ? AppColors.error : context.textMuted,
        fontWeight: FontWeight.w600,
      ),
    );
  }
}

/// A base quantity written in the product's largest unit and its base unit:
/// `12 CRT + 5 PCE`; just the base unit when there is no packaging.
String stockText(Product product, Decimal qtyBase) {
  final base = product.baseUnit;
  final packs = [
    for (final u in product.units)
      if (u.factorToBase > Decimal.one) u,
  ]..sort((a, b) => b.factorToBase.compareTo(a.factorToBase));
  final baseLabel = base?.unitCode ?? '';
  if (packs.isEmpty || qtyBase <= Decimal.zero) {
    return Qty.withUnit(qtyBase, baseLabel);
  }
  final pack = packs.first;
  final whole = (qtyBase / pack.factorToBase).floor().toDecimal();
  final rest = qtyBase - whole * pack.factorToBase;
  final parts = [
    if (whole > Decimal.zero)
      '${Qty.format(whole, isolate: false)} ${pack.unitCode}',
    if (rest > Decimal.zero) '${Qty.format(rest, isolate: false)} $baseLabel',
  ];
  return Money.ltr(parts.join(' + '));
}

/// Unit choice and quantity for one product. Pops with (unit, quantity).
class AddProductSheet extends StatefulWidget {
  const AddProductSheet({
    super.key,
    required this.product,
    this.initialUnit,
    this.leftBase,
    this.initialQty,
    this.stockLabelKey = 'catalog.on_truck',
    this.actionLabelKey = 'sale.add_to_basket',
    this.actionIcon = Icons.add_shopping_cart,
  });

  final Product product;
  final ProductUnit? initialUnit;
  final Decimal? leftBase;

  /// Editing a line: its quantity (default 1).
  final Decimal? initialQty;
  final String stockLabelKey;
  final String actionLabelKey;
  final IconData actionIcon;

  @override
  State<AddProductSheet> createState() => _AddProductSheetState();
}

class _AddProductSheetState extends State<AddProductSheet> {
  late ProductUnit? _unit =
      widget.initialUnit ?? widget.product.defaultSaleUnit;
  late Decimal _qty = widget.initialQty ?? Decimal.one;
  late final _qtyText = TextEditingController(
    text: Qty.format(_qty, isolate: false),
  );

  @override
  void dispose() {
    _qtyText.dispose();
    super.dispose();
  }

  void _setQty(Decimal q) {
    final unit = _unit;
    var next = q < Decimal.zero ? Decimal.zero : q;
    if (unit != null && !unit.allowsDecimal) next = next.floor();
    setState(() => _qty = next);
    final shown = Qty.format(next, isolate: false);
    if (_qtyText.text != shown) _qtyText.text = shown;
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final p = widget.product;
    final unit = _unit;
    final left = widget.leftBase;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.xl,
            0,
            AppSpacing.xl,
            AppSpacing.xl,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(p.designation, style: text.titleMedium),
              Text(
                p.reference,
                style: text.bodySmall?.copyWith(color: context.textMuted),
              ),
              if (left != null) ...[
                AppSpacing.gapXs,
                StockLabel(
                  leftBase: left,
                  product: p,
                  labelKey: widget.stockLabelKey,
                ),
              ],
              AppSpacing.gapLg,
              if (p.units.length > 1)
                Wrap(
                  spacing: AppSpacing.sm,
                  runSpacing: AppSpacing.sm,
                  children: [
                    for (final u in p.units)
                      ChoiceChip(
                        label: Text(
                          u.factorToBase == Decimal.one
                              ? u.label
                              : '${u.label} (×${Qty.format(u.factorToBase, isolate: false)})',
                        ),
                        selected: unit?.unitId == u.unitId,
                        onSelected: (_) => setState(() => _unit = u),
                      ),
                  ],
                ),
              AppSpacing.gapLg,
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _qtyText,
                      keyboardType: TextInputType.numberWithOptions(
                        decimal: unit?.allowsDecimal ?? false,
                      ),
                      textDirection: TextDirection.ltr,
                      decoration: InputDecoration(
                        labelText: context.tr('sale.qty'),
                        suffixText: unit?.label,
                      ),
                      onChanged: (v) {
                        final q = Money.parseInput(v);
                        if (q != null) setState(() => _qty = q);
                      },
                    ),
                  ),
                  AppSpacing.gapMd,
                  QtyStepper(
                    label: Qty.format(_qty),
                    onDecrement: () => _setQty(_qty - Decimal.one),
                    onIncrement: () => _setQty(_qty + Decimal.one),
                    decrementTooltip: context.tr('sale.less'),
                    incrementTooltip: context.tr('sale.more'),
                  ),
                ],
              ),
              AppSpacing.gapXl,
              AppButton(
                label: context.tr(widget.actionLabelKey),
                icon: widget.actionIcon,
                onPressed: unit == null || _qty <= Decimal.zero
                    ? null
                    : () => Navigator.of(context).pop((unit, _qty)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
