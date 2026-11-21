import 'package:flutter/material.dart';

import '../../../../core/components/widgets/net_image.dart';
import '../../../../core/design/design.dart';
import '../../data/models/category.dart';

/// Round category icon (emoji or image) with its name underneath.
class CategoryBubble extends StatelessWidget {
  const CategoryBubble({
    super.key,
    required this.category,
    required this.onTap,
    this.selected = false,
  });

  final Category category;
  final VoidCallback onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 76,
      child: InkWell(
        borderRadius: AppRadius.mdAll,
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
          child: Column(
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                width: 60,
                height: 60,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: selected ? AppColors.accent : context.fieldFill,
                  border: Border.all(
                    color: selected
                        ? AppColors.accentDeep
                        : context.fieldBorder,
                  ),
                ),
                clipBehavior: Clip.antiAlias,
                child: category.image.isNotEmpty
                    ? NetImage(
                        url: category.image,
                        media: category.imageMedia,
                        emoji: category.icon,
                      )
                    : Center(
                        child: Text(
                          category.icon.isEmpty ? '🛍️' : category.icon,
                          style: const TextStyle(fontSize: 28),
                        ),
                      ),
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                category.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: AppTextStyles.caption.copyWith(
                  color: context.textMain,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w400,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
