import 'package:flutter/material.dart';

import '../../../../core/design/design.dart';
import '../../../../core/localization/tr.dart';

/// Sort orders accepted by `GET /products?sort=` (backend whitelist).
enum ProductSort {
  recommended(null, 'jb.sort.recommended'),
  newest('-createdAt', 'jb.sort.newest'),
  priceLow('price', 'jb.sort.price_low'),
  priceHigh('-price', 'jb.sort.price_high');

  const ProductSort(this.value, this.labelKey);

  final String? value;
  final String labelKey;
}

/// Icon button that opens a bottom sheet to pick a [ProductSort].
class SortButton extends StatelessWidget {
  const SortButton({super.key, required this.value, required this.onChanged});

  final ProductSort value;
  final ValueChanged<ProductSort> onChanged;

  @override
  Widget build(BuildContext context) {
    final active = value != ProductSort.recommended;
    return IconButton.filledTonal(
      tooltip: context.tr('jb.sort.title'),
      style: IconButton.styleFrom(
        backgroundColor: active ? AppColors.accent : context.fieldFill,
        foregroundColor: active ? AppColors.ink : context.textMain,
      ),
      icon: const Icon(Icons.swap_vert_rounded),
      onPressed: () async {
        final picked = await showModalBottomSheet<ProductSort>(
          context: context,
          // Above the floating bottom bar, not under it.
          useRootNavigator: true,
          showDragHandle: true,
          builder: (sheet) => SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: AppSpacing.screen,
                  child: AppSectionHeader(title: sheet.tr('jb.sort.title')),
                ),
                for (final sort in ProductSort.values)
                  ListTile(
                    title: Text(sheet.tr(sort.labelKey)),
                    trailing: sort == value
                        ? Icon(Icons.check_rounded, color: AppColors.accentDeep)
                        : null,
                    onTap: () => Navigator.pop(sheet, sort),
                  ),
                const SizedBox(height: AppSpacing.md),
              ],
            ),
          ),
        );
        if (picked != null && picked != value) onChanged(picked);
      },
    );
  }
}
