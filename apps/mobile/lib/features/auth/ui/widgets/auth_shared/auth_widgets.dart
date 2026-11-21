import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:orvynt_starter/core/components/widgets/shimmer/app_shimmer.dart';
import 'package:orvynt_starter/core/theme/app_theme.dart';
import 'package:orvynt_starter/core/design/app_text_styles.dart';

// ─── Role model ────────────────────────────────────────────────────────────────

class RoleItem {
  final String key;
  final String titleKey; // localization key
  final String subtitleKey;
  final String descriptionKey;
  final IconData icon;
  final List<Color> gradientDark;
  final List<Color> gradientLight;
  final Color accent;
  final String badge;

  const RoleItem({
    required this.key,
    required this.titleKey,
    required this.subtitleKey,
    required this.descriptionKey,
    required this.icon,
    required this.gradientDark,
    required this.gradientLight,
    required this.accent,
    this.badge = '',
  });
}

const kRoles = [
  RoleItem(
    key: 'consumer',
    titleKey: 'role_buyer',
    subtitleKey: 'role_buyer_subtitle',
    descriptionKey: 'role_buyer_desc',
    icon: Icons.shopping_bag_outlined,
    gradientDark: [Color(0xFF1C1A10), Color(0xFF2E2914), Color(0xFF4A4018)],
    gradientLight: [Color(0xFFFFF9E0), Color(0xFFFFF0B3), Color(0xFFFFE680)],
    accent: Color(0xFFFFD83A), // brand yellow
  ),
  RoleItem(
    key: 'seller',
    titleKey: 'role_seller',
    subtitleKey: 'role_seller_subtitle',
    descriptionKey: 'role_seller_desc',
    icon: Icons.storefront_outlined,
    gradientDark: [Color(0xFF0D1F2D), Color(0xFF1A3A5C), Color(0xFF1E5799)],
    gradientLight: [Color(0xFFE8F4FF), Color(0xFFD0E8FF), Color(0xFFB0D4FF)],
    accent: Color(0xFF5BB8FF),
    badge: 'PRO',
  ),
  RoleItem(
    key: 'delivery',
    titleKey: 'role_delivery',
    subtitleKey: 'role_delivery_subtitle',
    descriptionKey: 'role_delivery_desc',
    icon: Icons.delivery_dining_outlined,
    gradientDark: [Color(0xFF1A1A0D), Color(0xFF2D3A1A), Color(0xFF4A6629)],
    gradientLight: [Color(0xFFF0F9E8), Color(0xFFDFF2CC), Color(0xFFC8E8A0)],
    accent: Color(0xFF5A9E2F),
  ),
];

// ─── Glow decoration ──────────────────────────────────────────────────────────

class AuthGlow extends StatelessWidget {
  final double size;
  final Color color;
  const AuthGlow({super.key, required this.size, required this.color});

  @override
  Widget build(BuildContext context) {
    return ImageFiltered(
      imageFilter: ImageFilter.blur(sigmaX: 55, sigmaY: 55),
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      ),
    );
  }
}

// ─── Gradient button ──────────────────────────────────────────────────────────

class AuthGradBtn extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  final List<Color> colors;
  final bool loading;
  const AuthGradBtn({
    super.key,
    required this.label,
    required this.onTap,
    required this.colors,
    this.loading = false,
  });

  @override
  Widget build(BuildContext context) {
    final onFill = colors.first.computeLuminance() > 0.5
        ? AppColors.ink
        : Colors.white;
    return GestureDetector(
      onTap: loading ? null : onTap,
      child: Container(
        width: double.infinity,
        padding: EdgeInsets.symmetric(vertical: 18.h),
        decoration: BoxDecoration(
          gradient: LinearGradient(colors: colors),
          borderRadius: BorderRadius.circular(18.r),
          boxShadow: [
            BoxShadow(
              color: colors.first.withValues(alpha: 0.35),
              blurRadius: 20,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        child: loading
            ? Center(
                child: SizedBox(
                  height: 20.h,
                  width: 20.h,
                  child: ShimmerWrapper(
                    child: ShimmerBlock(
                      width: 20.h,
                      height: 20.h,
                      shape: BoxShape.circle,
                      color: onFill.withValues(alpha: 0.24),
                    ),
                  ),
                ),
              )
            : Text(
                label,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: onFill,
                  fontSize: 16.sp,
                  fontWeight: FontWeight.w800,
                ),
              ),
      ),
    );
  }
}

// ─── Border button ────────────────────────────────────────────────────────────

class AuthBorderBtn extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  final IconData? icon;
  const AuthBorderBtn({
    super.key,
    required this.label,
    required this.onTap,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: EdgeInsets.symmetric(vertical: 17.h),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18.r),
          border: Border.all(
            color: isDark
                ? Colors.white.withValues(alpha: 0.14)
                : Colors.black.withValues(alpha: 0.14),
            width: 1.5,
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (icon != null) ...[
              Icon(
                icon,
                color: isDark ? Colors.white54 : Colors.black45,
                size: 17.sp,
              ),
              SizedBox(width: 8.w),
            ],
            Text(
              label,
              style: TextStyle(
                color: isDark ? Colors.white54 : Colors.black54,
                fontSize: 15.sp,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Back button ──────────────────────────────────────────────────────────────

class AuthBackBtn extends StatelessWidget {
  final VoidCallback onTap;
  const AuthBackBtn({super.key, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 44.w,
        height: 44.w,
        decoration: BoxDecoration(
          color: isDark
              ? Colors.white.withValues(alpha: 0.08)
              : Colors.black.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(14.r),
          border: Border.all(
            color: isDark
                ? Colors.white.withValues(alpha: 0.07)
                : Colors.black.withValues(alpha: 0.07),
          ),
        ),
        child: Icon(
          Icons.arrow_back_ios_new_rounded,
          color: isDark ? Colors.white : Colors.black87,
          size: 15.sp,
        ),
      ),
    );
  }
}

// ─── Circle button ────────────────────────────────────────────────────────────

class AuthCircleBtn extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  const AuthCircleBtn({super.key, required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 46.w,
        height: 46.w,
        decoration: BoxDecoration(
          color: isDark
              ? Colors.white.withValues(alpha: 0.10)
              : Colors.black.withValues(alpha: 0.07),
          borderRadius: BorderRadius.circular(16.r),
        ),
        child: Icon(
          icon,
          color: isDark ? Colors.white : Colors.black87,
          size: 17.sp,
        ),
      ),
    );
  }
}

// ─── Or divider ───────────────────────────────────────────────────────────────

class AuthOrDivider extends StatelessWidget {
  const AuthOrDivider({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Row(
      children: [
        Expanded(
          child: Divider(
            color: isDark
                ? Colors.white.withValues(alpha: 0.09)
                : Colors.black.withValues(alpha: 0.09),
            height: 1,
          ),
        ),
        Padding(
          padding: EdgeInsets.symmetric(horizontal: 14.w),
          child: Text(
            'or',
            style: TextStyle(
              color: isDark ? Colors.white24 : Colors.black26,
              fontSize: 13.sp,
            ),
          ),
        ),
        Expanded(
          child: Divider(
            color: isDark
                ? Colors.white.withValues(alpha: 0.09)
                : Colors.black.withValues(alpha: 0.09),
            height: 1,
          ),
        ),
      ],
    );
  }
}

// ─── Switch text (already have account?) ──────────────────────────────────────

class AuthSwitchText extends StatelessWidget {
  final String prompt;
  final String action;
  final Color accent;
  final VoidCallback onTap;
  const AuthSwitchText({
    super.key,
    required this.prompt,
    required this.action,
    required this.accent,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final readable = isDark || accent.computeLuminance() < 0.5;
    return Text.rich(
      TextSpan(
        text: prompt,
        style: TextStyle(
          fontFamily: AppTextStyles.fontFamily,
          color: isDark ? Colors.white38 : Colors.black45,
          fontSize: 14.sp,
        ),
        children: [
          WidgetSpan(
            child: GestureDetector(
              onTap: onTap,
              child: Text(
                action,
                style: TextStyle(
                  fontFamily: AppTextStyles.fontFamily,
                  color: readable ? accent : AppColors.ink,
                  fontWeight: FontWeight.w700,
                  fontSize: 14.sp,
                  decoration: readable ? null : TextDecoration.underline,
                  decorationColor: accent,
                  decorationThickness: 2.5,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Text field ───────────────────────────────────────────────────────────────

class AuthField extends StatefulWidget {
  final TextEditingController controller;
  final String hint;
  final IconData icon;
  final bool obscure;
  final TextInputType keyboardType;
  const AuthField({
    super.key,
    required this.controller,
    required this.hint,
    required this.icon,
    this.obscure = false,
    this.keyboardType = TextInputType.text,
  });

  @override
  State<AuthField> createState() => _AuthFieldState();
}

class _AuthFieldState extends State<AuthField> {
  bool _show = false;
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Focus(
      onFocusChange: (focused) => setState(() => _focused = focused),
      child: _field(isDark),
    );
  }

  Widget _field(bool isDark) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 180),
      decoration: BoxDecoration(
        color: isDark
            ? Colors.white.withValues(alpha: 0.06)
            : Colors.black.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(16.r),
        border: Border.all(
          color: _focused
              ? AppColors.yellow
              : isDark
              ? Colors.white.withValues(alpha: 0.08)
              : Colors.black.withValues(alpha: 0.08),
          width: _focused ? 1.8 : 1,
        ),
      ),
      child: TextField(
        controller: widget.controller,
        obscureText: widget.obscure && !_show,
        keyboardType: widget.keyboardType,
        style: TextStyle(
          color: isDark ? Colors.white : Colors.black87,
          fontSize: 15.sp,
          fontWeight: FontWeight.w500,
        ),
        decoration: InputDecoration(
          hintText: widget.hint,
          hintStyle: TextStyle(
            color: isDark ? Colors.white24 : Colors.black26,
            fontSize: 14.sp,
          ),
          prefixIcon: Icon(
            widget.icon,
            color: _focused
                ? (isDark ? AppColors.yellow : AppColors.ink)
                : (isDark ? Colors.white24 : Colors.black26),
            size: 18.sp,
          ),
          suffixIcon: widget.obscure
              ? IconButton(
                  icon: Icon(
                    _show
                        ? Icons.visibility_off_outlined
                        : Icons.visibility_outlined,
                    color: isDark ? Colors.white24 : Colors.black26,
                    size: 18.sp,
                  ),
                  onPressed: () => setState(() => _show = !_show),
                )
              : null,
          border: InputBorder.none,
          contentPadding: EdgeInsets.symmetric(
            horizontal: 16.w,
            vertical: 18.h,
          ),
        ),
      ),
    );
  }
}

// ─── Dropdown field ───────────────────────────────────────────────────────────

class AuthDropdownField<T> extends StatelessWidget {
  final String hint;
  final IconData icon;
  final T? value;
  final List<DropdownMenuItem<T>> items;
  final ValueChanged<T?> onChanged;

  const AuthDropdownField({
    super.key,
    required this.hint,
    required this.icon,
    required this.value,
    required this.items,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      decoration: BoxDecoration(
        color: isDark
            ? Colors.white.withValues(alpha: 0.06)
            : Colors.black.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(16.r),
        border: Border.all(
          color: isDark
              ? Colors.white.withValues(alpha: 0.08)
              : Colors.black.withValues(alpha: 0.08),
        ),
      ),
      child: DropdownButtonFormField<T>(
        initialValue: value,
        items: items,
        onChanged: onChanged,
        isExpanded: true,
        decoration: InputDecoration(
          prefixIcon: Icon(
            icon,
            color: isDark ? Colors.white24 : Colors.black26,
            size: 18.sp,
          ),
          border: InputBorder.none,
          contentPadding: EdgeInsets.symmetric(
            horizontal: 16.w,
            vertical: 17.h,
          ),
        ),
        dropdownColor: isDark ? const Color(0xFF1A1A2E) : Colors.white,
        icon: Icon(
          Icons.arrow_drop_down,
          color: isDark ? Colors.white54 : Colors.black45,
          size: 20.sp,
        ),
        hint: Text(
          hint,
          style: TextStyle(
            color: isDark ? Colors.white24 : Colors.black26,
            fontSize: 14.sp,
          ),
        ),
        style: TextStyle(
          color: isDark ? Colors.white : Colors.black87,
          fontSize: 15.sp,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}

// ─── Mini role card (for welcome screen stack) ────────────────────────────────

class MiniRoleCard extends StatelessWidget {
  final RoleItem role;
  final double rotation;
  final double scale;
  const MiniRoleCard({
    super.key,
    required this.role,
    required this.rotation,
    this.scale = 1.0,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final gradient = isDark ? role.gradientDark : role.gradientLight;

    return Transform.rotate(
      angle: rotation,
      child: Transform.scale(
        scale: scale,
        child: Container(
          width: 108.w,
          height: 138.h,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: gradient,
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(20.r),
            border: Border.all(
              color: role.accent.withValues(alpha: isDark ? 0.28 : 0.40),
              width: 1,
            ),
            boxShadow: [
              BoxShadow(
                color: role.accent.withValues(alpha: 0.18),
                blurRadius: 18,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                padding: EdgeInsets.all(9.w),
                decoration: BoxDecoration(
                  color: role.accent.withValues(alpha: 0.14),
                  shape: BoxShape.circle,
                ),
                child: Icon(role.icon, color: role.accent, size: 24.sp),
              ),
              SizedBox(height: 8.h),
              Text(
                role.key == 'consumer'
                    ? 'Buyer'
                    : role.key == 'seller'
                    ? 'Seller'
                    : 'Rider',
                style: TextStyle(
                  color: isDark ? Colors.white : Colors.black87,
                  fontWeight: FontWeight.w800,
                  fontSize: 12.sp,
                ),
              ),
              SizedBox(height: 2.h),
              Text(
                role.key == 'consumer'
                    ? 'Shop & Discover'
                    : role.key == 'seller'
                    ? 'Grow Business'
                    : 'Deliver & Earn',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: role.accent.withValues(alpha: 0.8),
                  fontSize: 9.sp,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Big role card (for role picker PageView) ─────────────────────────────────

class BigRoleCard extends StatelessWidget {
  final RoleItem role;
  final bool isActive;
  const BigRoleCard({super.key, required this.role, required this.isActive});

  @override
  Widget build(BuildContext context) {
    return AnimatedOpacity(
      duration: const Duration(milliseconds: 250),
      opacity: isActive ? 1.0 : 0.50,
      child: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              role.accent.withValues(alpha: 0.08),
              Colors.white.withValues(alpha: 0.04),
            ],
          ),
          borderRadius: BorderRadius.circular(32.r),
          border: Border.all(
            color: role.accent.withValues(alpha: isActive ? 0.35 : 0.12),
            width: isActive ? 1.5 : 1,
          ),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(31.r),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 8, sigmaY: 8),
            child: Stack(
              children: [
                Center(
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 320),
                    width: isActive ? 108.w : 78.w,
                    height: isActive ? 108.w : 78.w,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: role.accent.withValues(
                        alpha: isActive ? 0.16 : 0.08,
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: role.accent.withValues(
                            alpha: isActive ? 0.30 : 0.10,
                          ),
                          blurRadius: isActive ? 40 : 18,
                          spreadRadius: isActive ? 10 : 4,
                        ),
                      ],
                    ),
                    child: Icon(
                      role.icon,
                      color: role.accent,
                      size: isActive ? 50.sp : 34.sp,
                    ),
                  ),
                ),
                if (role.badge.isNotEmpty)
                  Positioned(
                    top: 16.h,
                    right: 16.w,
                    child: Container(
                      padding: EdgeInsets.symmetric(
                        horizontal: 10.w,
                        vertical: 4.h,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFEC4899),
                        borderRadius: BorderRadius.circular(12.r),
                      ),
                      child: Text(
                        role.badge,
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 10.sp,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ─── Snack helper ─────────────────────────────────────────────────────────────

void showAuthSnack(BuildContext context, String msg, {bool err = false}) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(msg),
      backgroundColor: err ? Colors.redAccent : AppColors.secondaryColor,
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
  );
}
