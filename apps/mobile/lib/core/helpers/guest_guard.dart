/// Guest-guard helpers.
///
/// Call [guardGuest] before any action that requires authentication.
/// It returns `true` when the current user **is** a guest and automatically
/// shows an animated "sign-in required" dialog.
library;

import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:go_router/go_router.dart';

import '../design/design.dart';
import '../di/dependency_injection.dart';
import '../localization/app_localizations.dart';
import '../router/routes.dart';
import '../session/session_cubit.dart';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Returns `true` if the user is a guest (unauthenticated).
///
/// No UI side-effects — use this for simple checks.
bool isGuest(BuildContext context) {
  SessionCubit session;
  try {
    session = context.read<SessionCubit>();
  } catch (_) {
    session = getIt<SessionCubit>();
  }
  return !session.state.isAuthenticated;
}

/// Returns `true` when the user **is** a guest.
///
/// When `true`, an animated sign-in dialog is shown automatically.
/// When `false`, the caller can proceed — the user is authenticated.
bool guardGuest(BuildContext context, {String? message}) {
  if (!isGuest(context)) return false;
  showGuestDialog(context);
  return true;
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

/// Shows a premium animated dialog asking the guest to sign in.
Future<void> showGuestDialog(BuildContext context) async {
  await showGeneralDialog(
    context: context,
    barrierDismissible: true,
    barrierLabel: 'Dismiss',
    barrierColor: Colors.black54,
    transitionDuration: const Duration(milliseconds: 400),
    transitionBuilder: (ctx, anim, secondAnim, child) {
      final curved = CurvedAnimation(parent: anim, curve: Curves.easeOutBack);
      return ScaleTransition(
        scale: Tween<double>(begin: 0.8, end: 1.0).animate(curved),
        child: FadeTransition(opacity: anim, child: child),
      );
    },
    pageBuilder: (ctx, anim, secondAnim) => const _GuestDialog(),
  );
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

class _GuestDialog extends StatefulWidget {
  const _GuestDialog();

  @override
  State<_GuestDialog> createState() => _GuestDialogState();
}

class _GuestDialogState extends State<_GuestDialog>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;
  late final Animation<double> _iconScale;
  late final Animation<double> _iconFade;
  late final Animation<Offset> _slideUp;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    );

    _iconScale = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _ctrl,
        curve: const Interval(0.0, 0.5, curve: Curves.elasticOut),
      ),
    );
    _iconFade = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _ctrl,
        curve: const Interval(0.0, 0.4, curve: Curves.easeIn),
      ),
    );
    _slideUp = Tween<Offset>(begin: const Offset(0, 0.15), end: Offset.zero)
        .animate(
          CurvedAnimation(
            parent: _ctrl,
            curve: const Interval(0.25, 0.75, curve: Curves.easeOutCubic),
          ),
        );

    _ctrl.forward();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final loc = AppLocalizations.of(context);

    final bgColor = isDark ? AppColors.darkSurface : AppColors.white;
    final accentFg = isDark ? AppColors.ink : AppColors.accent;
    final accentBg = isDark ? AppColors.accent : AppColors.ink;
    final subtitleColor = isDark ? Colors.grey.shade400 : Colors.grey.shade600;

    return Center(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 8, sigmaY: 8),
        child: Container(
          width: MediaQuery.of(context).size.width * 0.85,
          constraints: BoxConstraints(maxWidth: 380.w),
          decoration: BoxDecoration(
            color: bgColor,
            borderRadius: BorderRadius.circular(24.r),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: isDark ? 0.5 : 0.15),
                blurRadius: 40,
                offset: const Offset(0, 16),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(24.r),
            child: Material(
              color: Colors.transparent,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // ── Gradient accent bar ──
                  Container(
                    height: 4.h,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          AppColors.accent,
                          AppColors.accent.withValues(alpha: 0.6),
                          AppColors.accent.withValues(alpha: 0.2),
                        ],
                      ),
                    ),
                  ),

                  SizedBox(height: 28.h),

                  // ── Animated lock icon ──
                  AnimatedBuilder(
                    animation: _ctrl,
                    builder: (context, child) {
                      return FadeTransition(
                        opacity: _iconFade,
                        child: ScaleTransition(scale: _iconScale, child: child),
                      );
                    },
                    child: Container(
                      width: 76.w,
                      height: 76.w,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            AppColors.accent.withValues(alpha: 0.35),
                            AppColors.accent.withValues(alpha: 0.1),
                          ],
                        ),
                        border: Border.all(
                          color: AppColors.accent.withValues(alpha: 0.5),
                          width: 1.5,
                        ),
                      ),
                      child: Icon(
                        Icons.lock_outline_rounded,
                        size: 36.sp,
                        color: isDark ? AppColors.accent : AppColors.ink,
                      ),
                    ),
                  ),

                  SizedBox(height: 20.h),

                  // ── Title & Message ──
                  SlideTransition(
                    position: _slideUp,
                    child: FadeTransition(
                      opacity: CurvedAnimation(
                        parent: _ctrl,
                        curve: const Interval(0.3, 0.8, curve: Curves.easeOut),
                      ),
                      child: Padding(
                        padding: EdgeInsets.symmetric(horizontal: 24.w),
                        child: Column(
                          children: [
                            Text(
                              loc?.translate('guest_mode_title') ??
                                  'Sign In Required',
                              textAlign: TextAlign.center,
                              style: theme.textTheme.headlineMedium?.copyWith(
                                fontWeight: FontWeight.w700,
                                fontSize: 20.sp,
                              ),
                            ),
                            SizedBox(height: 10.h),
                            Text(
                              loc?.translate('guest_mode_message') ??
                                  'You\'re browsing as a guest. Please sign in to use this feature.',
                              textAlign: TextAlign.center,
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: subtitleColor,
                                height: 1.5,
                                fontSize: 13.5.sp,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),

                  SizedBox(height: 28.h),

                  // ── Actions ──
                  SlideTransition(
                    position: _slideUp,
                    child: FadeTransition(
                      opacity: CurvedAnimation(
                        parent: _ctrl,
                        curve: const Interval(0.45, 0.9, curve: Curves.easeOut),
                      ),
                      child: Padding(
                        padding: EdgeInsets.symmetric(horizontal: 24.w),
                        child: Column(
                          children: [
                            // Sign In button
                            SizedBox(
                              width: double.infinity,
                              height: 50.h,
                              child: ElevatedButton(
                                onPressed: () => _goToSignIn(context),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: accentBg,
                                  foregroundColor: accentFg,
                                  elevation: 0,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(14.r),
                                  ),
                                ),
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  children: [
                                    Icon(Icons.login_rounded, size: 20.sp),
                                    SizedBox(width: 8.w),
                                    Text(
                                      loc?.translate('sign_in') ?? 'Sign In',
                                      style: TextStyle(
                                        fontWeight: FontWeight.w600,
                                        fontSize: 15.sp,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),

                            SizedBox(height: 10.h),

                            // Cancel button
                            SizedBox(
                              width: double.infinity,
                              height: 44.h,
                              child: TextButton(
                                onPressed: () => Navigator.of(context).pop(),
                                style: TextButton.styleFrom(
                                  foregroundColor: subtitleColor,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(14.r),
                                  ),
                                ),
                                child: Text(
                                  loc?.translate('cancel') ?? 'Cancel',
                                  style: TextStyle(
                                    fontSize: 14.sp,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),

                  SizedBox(height: 16.h),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _goToSignIn(BuildContext context) {
    Navigator.of(context).pop(); // close dialog
    context.push(Routes.login);
  }
}
