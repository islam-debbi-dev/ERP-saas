import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:shimmer/shimmer.dart';
import '../../../theme/app_theme.dart';

// ──────────────────────────────────────────────────────────────────────────────
// Core Shimmer Utilities
// ──────────────────────────────────────────────────────────────────────────────

/// Returns the shimmer base/highlight/block colors based on the current theme.
class ShimmerColors {
  final Color base;
  final Color highlight;
  final Color block;

  const ShimmerColors({
    required this.base,
    required this.highlight,
    required this.block,
  });

  factory ShimmerColors.of(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    if (isDark) {
      return const ShimmerColors(
        base: Color(0xFF2A3441),
        highlight: Color(0xFF3A4758),
        block: Color(0xFF233041),
      );
    }
    return const ShimmerColors(
      base: Color(0xFFE8E8E8),
      highlight: AppColors.surface,
      block: Color(0xFFDDDDDD),
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Primitive shimmer shapes – combine these to build any skeleton
// ──────────────────────────────────────────────────────────────────────────────

/// A single rectangular / circular placeholder block.
class ShimmerBlock extends StatelessWidget {
  final double width;
  final double height;
  final double borderRadius;
  final BoxShape shape;
  final Color? color;

  const ShimmerBlock({
    super.key,
    required this.width,
    required this.height,
    this.borderRadius = 12,
    this.shape = BoxShape.rectangle,
    this.color,
  });

  @override
  Widget build(BuildContext context) {
    final blockColor = color ?? ShimmerColors.of(context).block;
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: blockColor,
        shape: shape,
        borderRadius: shape == BoxShape.circle
            ? null
            : BorderRadius.circular(borderRadius.r),
      ),
    );
  }
}

/// Wraps [child] in a [Shimmer.fromColors] with the correct theme colors.
class ShimmerWrapper extends StatelessWidget {
  final Widget child;

  const ShimmerWrapper({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final colors = ShimmerColors.of(context);
    return Shimmer.fromColors(
      baseColor: colors.base,
      highlightColor: colors.highlight,
      child: child,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Pre-built card shimmers (matching the real card layouts)
// ──────────────────────────────────────────────────────────────────────────────

/// Shimmer skeleton matching [FoodItemCard] (horizontal scrolling cards).
class FoodItemCardShimmer extends StatelessWidget {
  const FoodItemCardShimmer({super.key});

  @override
  Widget build(BuildContext context) {
    final widthScreen = MediaQuery.of(context).size.width;
    return ShimmerWrapper(
      child: Container(
        width: widthScreen * 0.5,
        decoration: BoxDecoration(
          color: ShimmerColors.of(context).block.withValues(alpha: 0.3),
          borderRadius: BorderRadius.circular(16.r),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Image placeholder
            ShimmerBlock(
              width: double.infinity,
              height: 160.h,
              borderRadius: 16,
            ),
            // Content placeholders
            Padding(
              padding: EdgeInsets.all(12.w),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ShimmerBlock(width: 120.w, height: 14.h),
                  SizedBox(height: 6.h),
                  ShimmerBlock(width: 80.w, height: 10.h),
                  SizedBox(height: 12.h),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      ShimmerBlock(width: 60.w, height: 10.h),
                      ShimmerBlock(width: 30.w, height: 10.h),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Shimmer skeleton matching [ProductItemCard] (vertical list cards).
class ProductItemCardShimmer extends StatelessWidget {
  const ProductItemCardShimmer({super.key});

  @override
  Widget build(BuildContext context) {
    return ShimmerWrapper(
      child: Container(
        width: double.infinity,
        decoration: BoxDecoration(
          color: ShimmerColors.of(context).block.withValues(alpha: 0.3),
          borderRadius: BorderRadius.circular(16.r),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Image placeholder
            ShimmerBlock(
              width: double.infinity,
              height: 220.h,
              borderRadius: 16,
            ),
            // Content placeholders
            Padding(
              padding: EdgeInsets.all(16.w),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            ShimmerBlock(width: 180.w, height: 18.h),
                            SizedBox(height: 6.h),
                            ShimmerBlock(width: 240.w, height: 12.h),
                          ],
                        ),
                      ),
                      ShimmerBlock(width: 50.w, height: 24.h, borderRadius: 8),
                    ],
                  ),
                  SizedBox(height: 16.h),
                  ShimmerBlock(width: 90.w, height: 20.h),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Shimmer skeleton matching an order card layout.
class OrderCardShimmer extends StatelessWidget {
  const OrderCardShimmer({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return ShimmerWrapper(
      child: Container(
        padding: EdgeInsets.all(16.w),
        decoration: BoxDecoration(
          color: isDark ? AppColors.darkSurface : AppColors.surface,
          borderRadius: BorderRadius.circular(22.r),
          border: Border.all(color: isDark ? Colors.white10 : Colors.black12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header row
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ShimmerBlock(width: 140.w, height: 16.h),
                    SizedBox(height: 6.h),
                    ShimmerBlock(width: 100.w, height: 12.h),
                  ],
                ),
                ShimmerBlock(width: 70.w, height: 26.h, borderRadius: 99),
              ],
            ),
            SizedBox(height: 14.h),
            // Product row placeholder
            _productRowShimmer(),
            SizedBox(height: 8.h),
            _productRowShimmer(),
            SizedBox(height: 14.h),
            // Pills row
            Row(
              children: [
                ShimmerBlock(width: 80.w, height: 28.h, borderRadius: 99),
                SizedBox(width: 8.w),
                ShimmerBlock(width: 100.w, height: 28.h, borderRadius: 99),
              ],
            ),
            SizedBox(height: 14.h),
            // Price
            Align(
              alignment: Alignment.centerRight,
              child: ShimmerBlock(width: 80.w, height: 18.h),
            ),
          ],
        ),
      ),
    );
  }

  Widget _productRowShimmer() {
    return Row(
      children: [
        ShimmerBlock(width: 50.w, height: 50.w, borderRadius: 12),
        SizedBox(width: 10.w),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ShimmerBlock(width: 140.w, height: 13.h),
              SizedBox(height: 4.h),
              ShimmerBlock(width: 100.w, height: 11.h),
            ],
          ),
        ),
      ],
    );
  }
}

/// Shimmer skeleton matching the store product grid card.
class StoreProductCardShimmer extends StatelessWidget {
  const StoreProductCardShimmer({super.key});

  @override
  Widget build(BuildContext context) {
    return ShimmerWrapper(
      child: Container(
        decoration: BoxDecoration(
          color: ShimmerColors.of(context).block.withValues(alpha: 0.3),
          borderRadius: BorderRadius.circular(16.r),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              flex: 3,
              child: ShimmerBlock(
                width: double.infinity,
                height: double.infinity,
                borderRadius: 16,
              ),
            ),
            Expanded(
              flex: 2,
              child: Padding(
                padding: EdgeInsets.all(10.w),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    ShimmerBlock(width: 100.w, height: 14.h),
                    SizedBox(height: 8.h),
                    ShimmerBlock(width: 60.w, height: 12.h),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Shimmer skeleton for delivery task cards.
class DeliveryTaskCardShimmer extends StatelessWidget {
  const DeliveryTaskCardShimmer({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return ShimmerWrapper(
      child: Container(
        padding: EdgeInsets.all(16.w),
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF171B22) : Colors.white,
          borderRadius: BorderRadius.circular(24.r),
          border: Border.all(
            color: isDark
                ? Colors.white.withValues(alpha: 0.08)
                : Colors.black.withValues(alpha: 0.06),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                ShimmerBlock(width: 46.w, height: 46.w, borderRadius: 16),
                SizedBox(width: 12.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      ShimmerBlock(width: 120.w, height: 16.h),
                      SizedBox(height: 5.h),
                      ShimmerBlock(width: 80.w, height: 12.h),
                    ],
                  ),
                ),
                ShimmerBlock(width: 70.w, height: 16.h),
              ],
            ),
            SizedBox(height: 14.h),
            // Product rows
            _productRow(),
            SizedBox(height: 8.h),
            _productRow(),
            SizedBox(height: 14.h),
            // Button placeholder
            ShimmerBlock(
              width: double.infinity,
              height: 44.h,
              borderRadius: 12,
            ),
          ],
        ),
      ),
    );
  }

  Widget _productRow() {
    return Row(
      children: [
        ShimmerBlock(width: 46.w, height: 46.w, borderRadius: 12),
        SizedBox(width: 10.w),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ShimmerBlock(width: 130.w, height: 13.h),
              SizedBox(height: 4.h),
              ShimmerBlock(width: 90.w, height: 11.h),
            ],
          ),
        ),
      ],
    );
  }
}

/// Shimmer for a simple notification list item.
class NotificationItemShimmer extends StatelessWidget {
  const NotificationItemShimmer({super.key});

  @override
  Widget build(BuildContext context) {
    return ShimmerWrapper(
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 12.h),
        child: Row(
          children: [
            ShimmerBlock(width: 48.w, height: 48.w, shape: BoxShape.circle),
            SizedBox(width: 14.w),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ShimmerBlock(width: 200.w, height: 14.h),
                  SizedBox(height: 6.h),
                  ShimmerBlock(width: 150.w, height: 12.h),
                  SizedBox(height: 4.h),
                  ShimmerBlock(width: 80.w, height: 10.h),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Full-page shimmer layouts
// ──────────────────────────────────────────────────────────────────────────────

/// Full-page shimmer for the Home screen (promo + categories + horizontal cards + vertical cards).
class HomePageShimmer extends StatelessWidget {
  const HomePageShimmer({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: 16.w),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(height: 10.h),
          // Promo banner skeleton
          ShimmerWrapper(
            child: ShimmerBlock(
              width: double.infinity,
              height: 180.h,
              borderRadius: 24,
            ),
          ),
          SizedBox(height: 20.h),
          // Categories row skeleton
          ShimmerWrapper(
            child: SizedBox(
              height: 42.h,
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                physics: const NeverScrollableScrollPhysics(),
                child: Row(
                  children: List.generate(
                    5,
                    (i) => Padding(
                      padding: EdgeInsets.only(right: 12.w),
                      child: ShimmerBlock(
                        width: 80.w,
                        height: 36.h,
                        borderRadius: 99,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          SizedBox(height: 20.h),
          // Section header
          ShimmerWrapper(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                ShimmerBlock(width: 100.w, height: 18.h),
                ShimmerBlock(width: 60.w, height: 14.h),
              ],
            ),
          ),
          SizedBox(height: 12.h),
          // Horizontal cards row
          SizedBox(
            height: 260.h,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: 3,
              separatorBuilder: (_, _) => SizedBox(width: 16.w),
              itemBuilder: (_, _) => const FoodItemCardShimmer(),
            ),
          ),
          SizedBox(height: 24.h),
          // Section header for vertical
          ShimmerWrapper(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                ShimmerBlock(width: 110.w, height: 18.h),
                ShimmerBlock(width: 60.w, height: 14.h),
              ],
            ),
          ),
          SizedBox(height: 12.h),
          // Vertical product cards
          ...List.generate(
            2,
            (i) => Padding(
              padding: EdgeInsets.only(bottom: 16.h),
              child: const ProductItemCardShimmer(),
            ),
          ),
        ],
      ),
    );
  }
}

/// Full-page shimmer for order list screens (MyOrders / SalesmanOrders).
class OrderListShimmer extends StatelessWidget {
  final int count;
  const OrderListShimmer({super.key, this.count = 4});

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: EdgeInsets.fromLTRB(16.w, 8.h, 16.w, 28.h),
      physics: const NeverScrollableScrollPhysics(),
      itemCount: count,
      separatorBuilder: (_, _) => SizedBox(height: 12.h),
      itemBuilder: (_, _) => const OrderCardShimmer(),
    );
  }
}

/// Full-page shimmer for the store product grid.
class StoreProductGridShimmer extends StatelessWidget {
  const StoreProductGridShimmer({super.key});

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      padding: EdgeInsets.zero,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 24.h,
        crossAxisSpacing: 16.w,
        childAspectRatio: 0.65,
      ),
      itemCount: 4,
      itemBuilder: (_, _) => const StoreProductCardShimmer(),
    );
  }
}

/// Full-page shimmer for delivery task list.
class DeliveryTaskListShimmer extends StatelessWidget {
  final int count;
  const DeliveryTaskListShimmer({super.key, this.count = 3});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: List.generate(
        count,
        (i) => Padding(
          padding: EdgeInsets.only(bottom: 12.h),
          child: const DeliveryTaskCardShimmer(),
        ),
      ),
    );
  }
}

/// Full-page shimmer for the delivery order details screen.
class DeliveryOrderDetailsShimmer extends StatelessWidget {
  const DeliveryOrderDetailsShimmer({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(16.w, 10.h, 16.w, 40.h),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _sectionShimmer(isDark),
          SizedBox(height: 20.h),
          _sectionShimmer(isDark),
          SizedBox(height: 20.h),
          _sectionShimmer(isDark),
          SizedBox(height: 24.h),
          ShimmerWrapper(
            child: ShimmerBlock(
              width: double.infinity,
              height: 54.h,
              borderRadius: 16,
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionShimmer(bool isDark) {
    return ShimmerWrapper(
      child: Container(
        padding: EdgeInsets.all(16.w),
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF171B22) : Colors.white,
          borderRadius: BorderRadius.circular(20.r),
          border: Border.all(
            color: isDark
                ? Colors.white.withValues(alpha: 0.08)
                : Colors.black.withValues(alpha: 0.06),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                ShimmerBlock(width: 36.w, height: 36.w, borderRadius: 10),
                SizedBox(width: 12.w),
                ShimmerBlock(width: 120.w, height: 18.h),
              ],
            ),
            SizedBox(height: 16.h),
            ShimmerBlock(width: double.infinity, height: 14.h),
            SizedBox(height: 8.h),
            ShimmerBlock(width: 200.w, height: 14.h),
            SizedBox(height: 8.h),
            ShimmerBlock(width: 160.w, height: 14.h),
          ],
        ),
      ),
    );
  }
}

/// Full-page shimmer for notification list.
class NotificationListShimmer extends StatelessWidget {
  final int count;
  const NotificationListShimmer({super.key, this.count = 6});

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      physics: const NeverScrollableScrollPhysics(),
      itemCount: count,
      itemBuilder: (_, _) => const NotificationItemShimmer(),
    );
  }
}

/// Shimmer for related products horizontal section.
class RelatedProductsShimmer extends StatelessWidget {
  const RelatedProductsShimmer({super.key});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 260.h,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        physics: const NeverScrollableScrollPhysics(),
        itemCount: 3,
        separatorBuilder: (_, _) => SizedBox(width: 16.w),
        itemBuilder: (_, _) => const FoodItemCardShimmer(),
      ),
    );
  }
}

/// A simple centered shimmer placeholder for generic full-page loading
/// (e.g. RoleAwareHomeScreen, initial scaffold loads).
class FullPageShimmer extends StatelessWidget {
  const FullPageShimmer({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 24.h),
          child: ShimmerWrapper(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // App bar placeholder
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    ShimmerBlock(width: 40.w, height: 40.w, borderRadius: 12),
                    ShimmerBlock(width: 120.w, height: 20.h),
                    ShimmerBlock(width: 40.w, height: 40.w, borderRadius: 12),
                  ],
                ),
                SizedBox(height: 32.h),
                // Content blocks
                ShimmerBlock(
                  width: double.infinity,
                  height: 180.h,
                  borderRadius: 20,
                ),
                SizedBox(height: 24.h),
                ShimmerBlock(width: 200.w, height: 18.h),
                SizedBox(height: 16.h),
                ShimmerBlock(
                  width: double.infinity,
                  height: 100.h,
                  borderRadius: 16,
                ),
                SizedBox(height: 16.h),
                ShimmerBlock(
                  width: double.infinity,
                  height: 100.h,
                  borderRadius: 16,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Shimmer for pagination "load more" at the bottom of a list.
class LoadMoreShimmer extends StatelessWidget {
  const LoadMoreShimmer({super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 16.h),
      child: ShimmerWrapper(
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            ShimmerBlock(width: 24.w, height: 24.w, shape: BoxShape.circle),
            SizedBox(width: 12.w),
            ShimmerBlock(width: 100.w, height: 14.h),
          ],
        ),
      ),
    );
  }
}
