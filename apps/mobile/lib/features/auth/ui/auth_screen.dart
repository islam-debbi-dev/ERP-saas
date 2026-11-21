import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:go_router/go_router.dart';

import '../../../core/components/brand_logo.dart';
import '../../../core/components/widgets/shimmer/app_shimmer.dart';
import '../../../core/config/app_env.dart';
import '../../../core/design/app_text_styles.dart';
import '../../../core/helpers/api_error_text.dart';
import '../../../core/localization/app_localizations.dart';
import '../../../core/localization/tr.dart';
import '../../../core/router/routes.dart';
import '../../../core/session/session_cubit.dart';
import '../../../core/theme/app_theme.dart';
import 'widgets/auth_shared/auth_widgets.dart';
import 'widgets/password_field.dart' show normalizeAlgerianPhone;

// ─── Auth phases ───────────────────────────────────────────────────────────────

enum AuthPhase { welcome, login, signup }

/// A successful sign-in / sign-up always lands on Home, even when auth was
/// pushed on top of another screen (`go` replaces the whole stack).
void _enterHome(BuildContext context) => context.go(Routes.home);

void _continueAsGuest(BuildContext context) {
  context.read<SessionCubit>().continueAsGuest();
  context.go(Routes.home);
}

// ─── Root entry ────────────────────────────────────────────────────────────────

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key, this.initialPhase = AuthPhase.welcome});

  /// `/login` and `/register` open straight on their form.
  final AuthPhase initialPhase;

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  late AuthPhase _phase = widget.initialPhase;

  /// Back from a form: to the welcome phase, or out of a pushed auth screen.
  void _back() {
    if (widget.initialPhase != AuthPhase.welcome && context.canPop()) {
      context.pop();
    } else {
      setState(() => _phase = AuthPhase.welcome);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 400),
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      transitionBuilder: (child, anim) => SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0.06, 0),
          end: Offset.zero,
        ).animate(anim),
        child: FadeTransition(opacity: anim, child: child),
      ),
      child: switch (_phase) {
        AuthPhase.welcome => _WelcomeScreen(
          key: const ValueKey('w'),
          onLogin: () => setState(() => _phase = AuthPhase.login),
          onSignup: () => setState(() => _phase = AuthPhase.signup),
        ),
        AuthPhase.login => _LoginScreen(
          key: const ValueKey('l'),
          onBack: _back,
          onGoSignup: () => setState(() => _phase = AuthPhase.signup),
        ),
        AuthPhase.signup => _SignupFormScreen(
          key: const ValueKey('s'),
          role: kRoles.first,
          onBack: _back,
          onGoLogin: () => setState(() => _phase = AuthPhase.login),
        ),
      },
    );
  }
}

// ─── Welcome Screen ────────────────────────────────────────────────────────────

class _WelcomeScreen extends StatefulWidget {
  final VoidCallback onLogin;
  final VoidCallback onSignup;
  const _WelcomeScreen({
    super.key,
    required this.onLogin,
    required this.onSignup,
  });
  @override
  State<_WelcomeScreen> createState() => _WelcomeScreenState();
}

class _WelcomeScreenState extends State<_WelcomeScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;
  late Animation<double> _fade;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    );
    _fade = CurvedAnimation(parent: _ctrl, curve: Curves.easeOut);
    _ctrl.forward();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final loc = AppLocalizations.of(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? AppColors.darkBackground : AppColors.background;

    return Scaffold(
      backgroundColor: bg,
      body: Stack(
        children: [
          Positioned(
            top: -100,
            right: -80,
            child: AuthGlow(
              size: 300,
              color: AppColors.yellow.withValues(alpha: isDark ? 0.16 : 0.45),
            ),
          ),
          Positioned(
            bottom: -80,
            left: -60,
            child: AuthGlow(
              size: 260,
              color: AppColors.yellowDeep.withValues(
                alpha: isDark ? 0.10 : 0.25,
              ),
            ),
          ),
          SafeArea(
            child: FadeTransition(
              opacity: _fade,
              child: Padding(
                padding: EdgeInsets.symmetric(horizontal: 28.w),
                child: Column(
                  children: [
                    SizedBox(height: 100.h),
                    AnimatedBrandLogo(size: 100),
                    SizedBox(height: 24.h),
                    Text(
                      // `app_name` is empty by default in the localization
                      // files so it never carries a previous client's brand;
                      // fall back to the env value when unset.
                      (loc?.translate('app_name') ?? '').trim().isEmpty
                          ? AppEnv.appName
                          : loc!.translate('app_name').trim(),
                      style: TextStyle(
                        fontSize: 44.sp,
                        fontWeight: FontWeight.w900,
                        color: isDark ? Colors.white : Colors.black87,
                        letterSpacing: -1.8,
                        height: 1,
                      ),
                    ),
                    SizedBox(height: 6.h),
                    Text(
                      loc?.translate('local_marketplace') ??
                          'Your local marketplace',
                      style: TextStyle(
                        fontSize: 15.sp,
                        color: isDark ? Colors.white38 : Colors.black38,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    SizedBox(height: 100.h),
                    AuthGradBtn(
                      label: loc?.translate('sign_in') ?? 'Sign In',
                      onTap: widget.onLogin,
                      colors: [AppColors.yellow, AppColors.yellowDeep],
                    ),
                    SizedBox(height: 12.h),
                    AuthBorderBtn(
                      label:
                          loc?.translate('create_account') ?? 'Create Account',
                      onTap: widget.onSignup,
                    ),
                    SizedBox(height: 10.h),
                    TextButton(
                      onPressed: () => _continueAsGuest(context),
                      child: Text(
                        loc?.translate('continue_as_guest') ??
                            'Continue as Guest',
                        style: TextStyle(
                          fontFamily: AppTextStyles.fontFamily,
                          color: isDark ? Colors.white30 : Colors.black38,
                          fontSize: 14.sp,
                          fontWeight: FontWeight.w600,
                          decoration: TextDecoration.underline,
                          decorationColor: isDark
                              ? Colors.white24
                              : Colors.black26,
                        ),
                      ),
                    ),
                    SizedBox(height: 24.h),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Login Screen ──────────────────────────────────────────────────────────────

class _LoginScreen extends StatefulWidget {
  final VoidCallback onBack;
  final VoidCallback onGoSignup;
  const _LoginScreen({
    super.key,
    required this.onBack,
    required this.onGoSignup,
  });

  @override
  State<_LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<_LoginScreen> {
  final _phone = TextEditingController();
  final _password = TextEditingController();
  bool _loading = false;

  @override
  void dispose() {
    _phone.dispose();
    _password.dispose();
    super.dispose();
  }

  /// `POST /auth/login` with phone + password.
  Future<void> _login() async {
    final phone = normalizeAlgerianPhone(_phone.text);
    if (phone == null) {
      return showAuthSnack(
        context,
        context.tr('error_invalid_phone'),
        err: true,
      );
    }
    if (_password.text.isEmpty) {
      return showAuthSnack(context, context.tr('password_required'), err: true);
    }
    setState(() => _loading = true);
    final failure = await context.read<SessionCubit>().login(
      phone,
      _password.text,
    );
    if (!mounted) return;
    setState(() => _loading = false);
    if (failure != null) {
      showAuthSnack(context, apiErrorText(context, failure), err: true);
    } else {
      _enterHome(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    final onBack = widget.onBack;
    final onGoSignup = widget.onGoSignup;
    final loc = AppLocalizations.of(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? AppColors.darkBackground : AppColors.background;

    return Scaffold(
      backgroundColor: bg,
      body: Stack(
        children: [
          Positioned(
            top: -60,
            right: -40,
            child: AuthGlow(
              size: 220,
              color: AppColors.yellow.withValues(alpha: isDark ? 0.14 : 0.40),
            ),
          ),
          SafeArea(
            child: SingleChildScrollView(
              padding: EdgeInsets.symmetric(horizontal: 28.w),
              child: Builder(
                builder: (ctx) {
                  final loading = _loading;
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(height: 16.h),
                      AuthBackBtn(onTap: onBack),
                      SizedBox(height: 36.h),
                      Text(
                        loc?.translate('welcome_back_heading') ??
                            'Welcome\nBack!',
                        style: TextStyle(
                          fontSize: 38.sp,
                          fontWeight: FontWeight.w900,
                          color: isDark ? Colors.white : Colors.black87,
                          height: 1.1,
                          letterSpacing: -1.2,
                        ),
                      ),
                      SizedBox(height: 6.h),
                      Text(
                        loc?.translate('sign_in_to_continue') ??
                            'Sign in to continue',
                        style: TextStyle(
                          fontSize: 15.sp,
                          color: isDark ? Colors.white38 : Colors.black38,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      SizedBox(height: 40.h),
                      AuthField(
                        controller: _phone,
                        hint: loc?.translate('phone_number') ?? 'Phone number',
                        icon: Icons.phone_outlined,
                        keyboardType: TextInputType.phone,
                      ),
                      SizedBox(height: 12.h),
                      AuthField(
                        controller: _password,
                        hint: loc?.translate('password') ?? 'Password',
                        icon: Icons.lock_outline_rounded,
                        obscure: true,
                      ),
                      SizedBox(height: 8.h),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          onPressed: () => context.push(Routes.forgotPassword),
                          child: Text(
                            loc?.translate('forgot_password') ??
                                'Forgot password?',
                            style: TextStyle(
                              fontFamily: AppTextStyles.fontFamily,
                              color: isDark ? AppColors.yellow : AppColors.ink,
                              fontSize: 13.sp,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                      SizedBox(height: 20.h),
                      AuthGradBtn(
                        label: loc?.translate('sign_in') ?? 'Sign In',
                        loading: loading,
                        onTap: _login,
                        colors: [AppColors.yellow, AppColors.yellowDeep],
                      ),
                      SizedBox(height: 12.h),
                      AuthBorderBtn(
                        label:
                            loc?.translate('continue_as_guest') ??
                            'Continue as Guest',
                        icon: Icons.person_outline_rounded,
                        onTap: () => _continueAsGuest(context),
                      ),
                      SizedBox(height: 28.h),
                      Center(
                        child: AuthSwitchText(
                          prompt:
                              loc?.translate('no_account_prompt') ??
                              "Don't have an account? ",
                          action: loc?.translate('sign_up') ?? 'Sign up',
                          accent: AppColors.yellow,
                          onTap: onGoSignup,
                        ),
                      ),
                      SizedBox(height: 28.h),
                    ],
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Signup Form Screen ───────────────────────────────────────────────────────

class _SignupFormScreen extends StatefulWidget {
  final RoleItem role;
  final VoidCallback onBack;
  final VoidCallback onGoLogin;
  const _SignupFormScreen({
    super.key,
    required this.role,
    required this.onBack,
    required this.onGoLogin,
  });

  @override
  State<_SignupFormScreen> createState() => _SignupFormScreenState();
}

class _SignupFormScreenState extends State<_SignupFormScreen> {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _loading = false;

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  /// `POST /auth/register` — clients only; email is optional.
  Future<void> _signup() async {
    final name = _name.text.trim();
    final phone = normalizeAlgerianPhone(_phone.text);
    final email = _email.text.trim();
    String? error;
    if (name.length < 2) {
      error = 'username_too_short';
    } else if (phone == null) {
      error = 'error_invalid_phone';
    } else if (email.isNotEmpty &&
        !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) {
      error = 'jb.auth.invalid_email';
    } else if (_password.text.length < 6) {
      error = 'password_too_short';
    }
    if (error != null) {
      return showAuthSnack(context, context.tr(error), err: true);
    }

    setState(() => _loading = true);
    final failure = await context.read<SessionCubit>().register(
      name: name,
      phone: phone!,
      password: _password.text,
      email: email.isEmpty ? null : email,
    );
    if (!mounted) return;
    setState(() => _loading = false);
    if (failure != null) {
      showAuthSnack(context, apiErrorText(context, failure), err: true);
    } else {
      _enterHome(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    final role = widget.role;
    final onBack = widget.onBack;
    final onGoLogin = widget.onGoLogin;
    final loc = AppLocalizations.of(context);
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? AppColors.darkBackground : AppColors.background;
    final titleStr =
        loc?.translate(role.titleKey) ??
        (role.key == 'consumer'
            ? 'Customer'
            : role.key == 'seller'
            ? 'Seller'
            : 'Rider');

    return Scaffold(
      backgroundColor: bg,
      body: Stack(
        children: [
          Positioned(
            top: -60,
            left: -40,
            child: AuthGlow(
              size: 200,
              color: role.accent.withValues(alpha: isDark ? 0.14 : 0.40),
            ),
          ),
          SafeArea(
            child: SingleChildScrollView(
              padding: EdgeInsets.symmetric(horizontal: 28.w),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(height: 16.h),
                  AuthBackBtn(onTap: onBack),
                  SizedBox(height: 24.h),
                  Container(
                    padding: EdgeInsets.symmetric(
                      horizontal: 14.w,
                      vertical: 7.h,
                    ),
                    decoration: BoxDecoration(
                      color: role.accent.withValues(
                        alpha: isDark ? 0.14 : 0.35,
                      ),
                      borderRadius: BorderRadius.circular(20.r),
                      border: Border.all(
                        color: role.accent.withValues(alpha: 0.6),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          role.icon,
                          color: isDark ? role.accent : AppColors.ink,
                          size: 13.sp,
                        ),
                        SizedBox(width: 6.w),
                        Text(
                          titleStr,
                          style: TextStyle(
                            color: isDark ? role.accent : AppColors.ink,
                            fontWeight: FontWeight.w700,
                            fontSize: 12.sp,
                          ),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(height: 16.h),
                  Text(
                    loc?.translate('get_started_free') ?? 'Get Started\nFree',
                    style: TextStyle(
                      fontSize: 38.sp,
                      fontWeight: FontWeight.w900,
                      color: isDark ? Colors.white : Colors.black87,
                      height: 1.1,
                      letterSpacing: -1.2,
                    ),
                  ),
                  SizedBox(height: 6.h),
                  Text(
                    loc?.translate('no_credit_card') ?? 'No credit card needed',
                    style: TextStyle(
                      fontSize: 14.sp,
                      color: isDark ? Colors.white38 : Colors.black38,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  SizedBox(height: 30.h),
                  AuthField(
                    controller: _name,
                    hint: loc?.translate('user_name') ?? 'Full name',
                    icon: Icons.person_outline_rounded,
                  ),
                  SizedBox(height: 12.h),
                  AuthField(
                    controller: _phone,
                    hint: loc?.translate('phone_number') ?? 'Phone number',
                    icon: Icons.phone_outlined,
                    keyboardType: TextInputType.phone,
                  ),
                  SizedBox(height: 12.h),
                  AuthField(
                    controller: _email,
                    hint:
                        '${loc?.translate('email_address') ?? 'Email address'} (${context.tr('jb.common.optional')})',
                    icon: Icons.email_outlined,
                    keyboardType: TextInputType.emailAddress,
                  ),
                  SizedBox(height: 12.h),
                  AuthField(
                    controller: _password,
                    hint: loc?.translate('password') ?? 'Password',
                    icon: Icons.lock_outline_rounded,
                    obscure: true,
                  ),
                  SizedBox(height: 28.h),
                  Builder(
                    builder: (ctx) {
                      final loading = _loading;
                      return GestureDetector(
                        onTap: loading ? null : _signup,
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 280),
                          width: double.infinity,
                          padding: EdgeInsets.symmetric(vertical: 18.h),
                          decoration: BoxDecoration(
                            gradient: loading
                                ? const LinearGradient(
                                    colors: [Colors.grey, Colors.grey],
                                  )
                                : const LinearGradient(
                                    colors: [
                                      AppColors.yellow,
                                      AppColors.yellowDeep,
                                    ],
                                  ),
                            borderRadius: BorderRadius.circular(18.r),
                            boxShadow: loading
                                ? null
                                : [
                                    BoxShadow(
                                      color: role.accent.withValues(
                                        alpha: 0.35,
                                      ),
                                      blurRadius: 20,
                                      offset: const Offset(0, 6),
                                    ),
                                  ],
                          ),
                          child: loading
                              ? Center(
                                  child: SizedBox(
                                    height: 22.h,
                                    width: 22.h,
                                    child: ShimmerWrapper(
                                      child: ShimmerBlock(
                                        width: 22.h,
                                        height: 22.h,
                                        shape: BoxShape.circle,
                                        color: Colors.black26,
                                      ),
                                    ),
                                  ),
                                )
                              : Text(
                                  loc?.translate('create_account') ??
                                      'Create Account',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: Colors.black87,
                                    fontSize: 16.sp,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                        ),
                      );
                    },
                  ),
                  SizedBox(height: 24.h),
                  Center(
                    child: AuthSwitchText(
                      prompt:
                          loc?.translate('already_have_account') ??
                          'Already have an account? ',
                      action: loc?.translate('sign_in') ?? 'Sign in',
                      accent: role.accent,
                      onTap: onGoLogin,
                    ),
                  ),
                  SizedBox(height: 32.h),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
