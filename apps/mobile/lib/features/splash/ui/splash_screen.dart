import 'dart:ui' show ImageFilter;
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/components/logo/jibli_logo.dart';
import '../../../core/router/routes.dart';
import '../../../core/session/session_cubit.dart';
import '../../../core/theme/app_theme.dart';
import '../../onboarding/logic/onboarding_store.dart';

// --- SPLASH SCREEN ---
class LogoSplashScreen extends StatefulWidget {
  const LogoSplashScreen({super.key});

  @override
  State<LogoSplashScreen> createState() => _LogoSplashScreenState();
}

class _LogoSplashScreenState extends State<LogoSplashScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  // The logo draws its own intro (trace → fill → shading); the splash only
  // adds the exit flourish at the end of the 3 s sequence.
  late Animation<double> _exitScale;
  late Animation<double> _exitOpacity;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 3),
    );

    // 5. Final exit flourish: Logo zooms in and fades out to transition (2.55s to 3.0s)
    _exitScale = Tween<double>(begin: 1.0, end: 1.5).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.85, 1.0, curve: Curves.easeInBack),
      ),
    );
    _exitOpacity = Tween<double>(begin: 1.0, end: 0.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.85, 1.0, curve: Curves.easeOut),
      ),
    );

    // Validate the stored session (`GET /auth/me`) while the logo plays,
    // then leave once both are done.
    final session = context.read<SessionCubit>();
    final restored = session.restore();
    _controller.addStatusListener((status) async {
      if (status != AnimationStatus.completed) return;
      await restored;
      final introSeen = await OnboardingStore.seen();
      if (!mounted) return;
      if (session.state.isAuthenticated) return context.go(Routes.home);
      context.go(introSeen ? Routes.auth : Routes.onboarding);
    });

    // Start the splash sequence
    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final double logoSize = MediaQuery.of(context).size.width * 0.5;

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
              color: AppColors.yellow.withValues(alpha: isDark ? 0.18 : 0.30),
            ),
          ),
          Positioned(
            bottom: -80,
            left: -60,
            child: AuthGlow(
              size: 260,
              color: AppColors.yellow.withValues(alpha: isDark ? 0.12 : 0.18),
            ),
          ),
          Center(
            child: AnimatedBuilder(
              animation: _controller,
              builder: (context, child) => Opacity(
                opacity: _exitOpacity.value,
                child: Transform.scale(scale: _exitScale.value, child: child),
              ),
              child: JibliLogo(
                size: logoSize,
                idle: false,
                duration: const Duration(milliseconds: 2200),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

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
