import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:orvynt_starter/core/localization/app_localizations.dart';
import 'package:orvynt_starter/core/design/app_spacing.dart';
import 'package:orvynt_starter/core/theme/app_theme.dart';
import '../../../../core/models/auth_user.dart';
import '../../../../core/components/widgets/net_image.dart';

// ignore: camel_case_types
class userCardInfo extends StatelessWidget {
  const userCardInfo({
    super.key,
    this.user,
    this.isLoading = false,
    this.errorMessage,
    this.onEditProfile,
  });

  final AuthUser? user;
  final bool isLoading;
  final String? errorMessage;
  final VoidCallback? onEditProfile;

  @override
  Widget build(BuildContext context) {
    final localization = AppLocalizations.of(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final displayName = isLoading
        ? localization?.translate('loading_user_info') ?? 'Loading...'
        : user?.name ??
              localization?.translate('no_user_info_available') ??
              'No user information available';
    final displayEmail = user?.email ?? '-';
    final displayPhone = user?.phone ?? '-';
    final displayRole = _formatRole(localization, user?.role);
    final displayLocation = _formatLocation(localization, user);
    final displayError = errorMessage != null
        ? _translateError(localization, errorMessage!)
        : '';

    // Profile header: yellow panel with an ink circle accent
    // (dark mode: elevated surface with a yellow circle).
    final headerBg = isDark ? AppColors.darkElevated : AppColors.accent;
    final shapeColor = isDark ? AppColors.accent : AppColors.ink;
    final onHeader = isDark ? Colors.white : AppColors.ink;

    return Container(
      margin: EdgeInsets.symmetric(horizontal: 16.w),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24.r),
        color: isDark ? AppColors.darkSurface : AppColors.white,
        boxShadow: AppShadows.soft,
      ),
      child: Column(
        children: [
          // ── Top Section: Avatar + Name + Edit ─────────────────────
          ClipRRect(
            borderRadius: BorderRadius.vertical(top: Radius.circular(24.r)),
            child: Container(
              color: headerBg,
              child: Stack(
                children: [
                  PositionedDirectional(
                    top: -34.h,
                    end: -34.w,
                    child: Container(
                      width: 110.w,
                      height: 110.w,
                      decoration: BoxDecoration(
                        color: shapeColor,
                        shape: BoxShape.circle,
                      ),
                    ),
                  ),
                  Padding(
                    padding: EdgeInsets.fromLTRB(20.w, 18.h, 16.w, 18.h),
                    child: Row(
                      children: [
                        // Avatar with gradient ring
                        Container(
                          padding: EdgeInsets.all(3.w),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: isDark ? AppColors.accent : AppColors.ink,
                          ),
                          child: Container(
                            padding: EdgeInsets.all(2.w),
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: isDark
                                  ? AppColors.darkSurface
                                  : Colors.white,
                            ),
                            child: SizedBox(
                              width: 64.w,
                              height: 64.w,
                              child: ClipOval(
                                // `/media/<id>/…` avatars are fetched as a thumbnail.
                                child: NetImage(
                                  url: user?.avatar,
                                  placeholderIcon: Icons.person_rounded,
                                ),
                              ),
                            ),
                          ),
                        ),
                        SizedBox(width: 14.w),
                        // Name + role badge
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                displayName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontWeight: FontWeight.w800,
                                  fontSize: 20.sp,
                                  letterSpacing: -0.5,
                                  color: onHeader,
                                ),
                              ),
                              SizedBox(height: 6.h),
                              Container(
                                padding: EdgeInsets.symmetric(
                                  horizontal: 10.w,
                                  vertical: 4.h,
                                ),
                                decoration: BoxDecoration(
                                  color: isDark
                                      ? AppColors.accent
                                      : AppColors.ink,
                                  borderRadius: BorderRadius.circular(20.r),
                                ),
                                child: Text(
                                  displayRole,
                                  style: TextStyle(
                                    color: isDark
                                        ? AppColors.ink
                                        : AppColors.white,
                                    fontSize: 12.sp,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        // Edit button
                        Material(
                          color: Colors.transparent,
                          child: InkWell(
                            onTap: onEditProfile,
                            customBorder: const CircleBorder(),
                            child: Container(
                              width: 48.w,
                              height: 48.w,
                              decoration: BoxDecoration(
                                color: Colors.white,
                                shape: BoxShape.circle,
                                boxShadow: AppShadows.soft,
                              ),
                              child: Icon(
                                Icons.edit_outlined,
                                color: AppColors.ink,
                                size: 20.sp,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),

          SizedBox(height: 14.h),

          // ── Info Grid ─────────────────────────────────────────────
          Padding(
            padding: EdgeInsets.fromLTRB(20.w, 0, 20.w, 18.h),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: _InfoTile(
                        icon: Icons.email_outlined,
                        label: localization?.translate('email') ?? 'Email',
                        value: displayEmail,
                        isDark: isDark,
                      ),
                    ),
                    SizedBox(width: 12.w),
                    Expanded(
                      child: _InfoTile(
                        icon: Icons.phone_outlined,
                        label: localization?.translate('phone') ?? 'Phone',
                        value: displayPhone,
                        isDark: isDark,
                      ),
                    ),
                  ],
                ),
                SizedBox(height: 10.h),
                _InfoTile(
                  icon: Icons.location_on_outlined,
                  label: localization?.translate('location') ?? 'Location',
                  value: displayLocation,
                  isDark: isDark,
                  fullWidth: true,
                ),
                if (displayError.isNotEmpty) ...[
                  SizedBox(height: 10.h),
                  Container(
                    width: double.infinity,
                    padding: EdgeInsets.symmetric(
                      horizontal: 12.w,
                      vertical: 8.h,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.error.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(10.r),
                      border: Border.all(
                        color: AppColors.error.withValues(alpha: 0.2),
                      ),
                    ),
                    child: Text(
                      displayError,
                      style: TextStyle(
                        color: AppColors.error,
                        fontSize: 12.sp,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _formatRole(AppLocalizations? localization, String? role) {
    if (role == null || role.isEmpty) return '-';
    final key = 'jb.role.$role';
    final translated = localization?.translate(key);
    return translated == null || translated == key ? role : translated;
  }

  /// Default delivery address, or a hint to add one.
  String _formatLocation(AppLocalizations? localization, AuthUser? user) {
    final address = user?.defaultAddress;
    if (address != null) {
      return [
        address.fullAddress,
        if (address.city != null) address.city,
      ].join(' · ');
    }
    return localization?.translate('location_not_set') ?? 'Location not set';
  }

  String _translateError(AppLocalizations? localization, String raw) {
    final translated = localization?.translate(raw);
    if (translated != null && translated != raw) return translated;
    return raw;
  }
}

// ── Reusable info tile ──────────────────────────────────────────────────────────

class _InfoTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final bool isDark;
  final bool fullWidth;

  const _InfoTile({
    required this.icon,
    required this.label,
    required this.value,
    required this.isDark,
    this.fullWidth = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: fullWidth ? double.infinity : null,
      padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
      decoration: BoxDecoration(
        color: isDark ? AppColors.darkElevated : AppColors.grouped,
        borderRadius: BorderRadius.circular(14.r),
      ),
      child: Row(
        children: [
          Icon(
            icon,
            size: 16.sp,
            color: isDark ? AppColors.accent : AppColors.ink,
          ),
          SizedBox(width: 8.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    color: isDark
                        ? AppColors.darkTextSecondary
                        : AppColors.textSecondary,
                    fontSize: 11.sp,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                SizedBox(height: 2.h),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: isDark ? Colors.white : AppColors.ink,
                    fontSize: 13.sp,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
