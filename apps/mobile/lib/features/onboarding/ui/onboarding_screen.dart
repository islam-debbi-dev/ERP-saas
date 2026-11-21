import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../../core/config/app_env.dart';
import '../../../core/design/design.dart';
import '../../../core/localization/tr.dart';
import '../../../core/router/routes.dart';
import '../logic/onboarding_store.dart';
import 'widgets/drop_scene.dart';
import 'widgets/language_switch.dart';
import 'widgets/story_progress.dart';
import 'widgets/swipe_to_start.dart';

/// One intro page: `jb.onboarding.<key>_title` / `_body` and its icons.
const _slides = [
  (
    'food',
    [
      Icons.lunch_dining_rounded,
      Icons.local_pizza_rounded,
      Icons.ramen_dining_rounded,
    ],
  ),
  (
    'groceries',
    [
      Icons.shopping_basket_rounded,
      Icons.eco_rounded,
      Icons.local_grocery_store_rounded,
    ],
  ),
  (
    'pay',
    [
      Icons.payments_rounded,
      Icons.two_wheeler_rounded,
      Icons.card_giftcard_rounded,
    ],
  ),
];

/// First-launch intro, told as one delivery: the Jibli parachute falls
/// through the sky page by page and lands on the last one, where the parcel
/// knob below "delivers" it into the app.
///
/// * Plays like a story: pages advance on a timer shown in the top bars.
///   Tap the sides to step, press and hold (or the pause button) to stop.
///   No autoplay with reduced motion or a screen reader on.
/// * The parachute can be grabbed and flung; the story waits meanwhile.
/// * Sliding the parcel to the end, on any page, finishes the intro.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen>
    with TickerProviderStateMixin {
  static const _pageTime = Duration(milliseconds: 4800);

  final _pages = PageController();
  final _slider = GlobalKey<SwipeToStartState>();

  /// Time spent on the current page, 0 → 1.
  late final AnimationController _story = AnimationController(
    vsync: this,
    duration: _pageTime,
  )..addStatusListener(_onStoryDone);

  /// Idle loop for sway, bobbing and drifting clouds.
  late final AnimationController _clock = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 6),
  );

  int _index = 0;
  bool _paused = false;
  bool _holding = false;
  bool _autoplay = true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final still = MediaQuery.disableAnimationsOf(context);
    _autoplay = !still && !MediaQuery.accessibleNavigationOf(context);
    if (still) {
      _clock.stop();
    } else if (!_clock.isAnimating) {
      _clock.repeat();
    }
    _resume();
  }

  @override
  void dispose() {
    _story.dispose();
    _clock.dispose();
    _pages.dispose();
    super.dispose();
  }

  bool get _last => _index == _slides.length - 1;

  double get _page => _pages.hasClients && _pages.position.haveDimensions
      ? _pages.page ?? 0
      : _index.toDouble();

  void _resume() {
    if (!_autoplay || _paused || _holding || _story.isCompleted) return;
    _story.forward();
  }

  void _onStoryDone(AnimationStatus status) {
    if (status != AnimationStatus.completed) return;
    if (_last) {
      // Landed: show what to do next.
      HapticFeedback.lightImpact();
      _slider.currentState?.nudge();
    } else {
      _go(_index + 1);
    }
  }

  void _go(int index) {
    if (index < 0 || index >= _slides.length) return;
    _pages.animateToPage(
      index,
      duration: const Duration(milliseconds: 650),
      curve: Curves.easeInOutCubic,
    );
  }

  void _onPageChanged(int index) {
    setState(() => _index = index);
    _story.value = 0;
  }

  void _setHolding(bool holding) {
    _holding = holding;
    holding ? _story.stop() : _resume();
  }

  void _togglePause() {
    setState(() => _paused = !_paused);
    _paused ? _story.stop() : _resume();
  }

  /// Tap the start third to go back, the end third to go on.
  void _onTap(TapUpDetails d, double width) {
    final x = Directionality.of(context) == TextDirection.rtl
        ? width - d.localPosition.dx
        : d.localPosition.dx;
    if (x < width / 3) {
      _go(_index - 1);
    } else if (x > width * 2 / 3) {
      _go(_index + 1);
    }
  }

  Future<void> _finish() async {
    _story.stop();
    await OnboardingStore.markSeen();
    if (mounted) context.go(Routes.auth);
  }

  @override
  Widget build(BuildContext context) {
    final colors = SceneColors.of(context);
    final dark = context.isDarkMode;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: dark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark,
      child: Scaffold(
        backgroundColor: colors.sky,
        body: SafeArea(
          child: Column(
            children: [
              _TopBar(
                colors: colors,
                index: _index,
                story: _story,
                autoplay: _autoplay,
                paused: _paused,
                onTogglePause: _togglePause,
              ),
              Expanded(child: _stage(colors)),
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.screenH,
                  0,
                  AppSpacing.screenH,
                  AppSpacing.lg,
                ),
                child: SwipeToStart(
                  key: _slider,
                  label: context.tr('jb.onboarding.slide'),
                  semanticHint: context.tr('jb.onboarding.slide_hint'),
                  onCompleted: _finish,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// Sky (upper part) + swipeable copy (lower part), with the parachute on
  /// top so it can be grabbed without the pages stealing the drag.
  Widget _stage(SceneColors colors) {
    return LayoutBuilder(
      builder: (context, box) {
        final skyHeight = box.maxHeight * 0.6;
        final mark = math.min(box.maxWidth * 0.46, skyHeight * 0.52);
        return Stack(
          children: [
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              height: skyHeight,
              child: AnimatedBuilder(
                animation: Listenable.merge([_pages, _clock]),
                builder: (context, _) => DropBackdrop(
                  page: _page,
                  clock: _clock.value,
                  icons: [for (final s in _slides) s.$2],
                  colors: colors,
                ),
              ),
            ),
            GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTapUp: (d) => _onTap(d, box.maxWidth),
              onLongPressStart: (_) => _setHolding(true),
              onLongPressEnd: (_) => _setHolding(false),
              child: NotificationListener<ScrollNotification>(
                onNotification: (n) {
                  // The story waits while the user drags the pages.
                  if (n is ScrollStartNotification && n.dragDetails != null) {
                    _story.stop();
                  } else if (n is ScrollEndNotification) {
                    _resume();
                  }
                  return false;
                },
                child: PageView.builder(
                  controller: _pages,
                  itemCount: _slides.length,
                  onPageChanged: _onPageChanged,
                  itemBuilder: (context, i) => Padding(
                    padding: EdgeInsets.only(top: skyHeight),
                    child: _Copy(
                      slideKey: _slides[i].$1,
                      active: i == _index,
                      ink: colors.ink,
                    ),
                  ),
                ),
              ),
            ),
            AnimatedBuilder(
              animation: Listenable.merge([_pages, _clock]),
              builder: (context, child) {
                final drop = _page / (_slides.length - 1);
                final wave = 2 * math.pi * _clock.value;
                return Positioned(
                  left: (box.maxWidth - mark) / 2,
                  // Falls from the top of the sky to just above the ground,
                  // bobbing a little on the way.
                  top:
                      skyHeight * 0.02 +
                      (skyHeight * 0.92 - mark) * drop +
                      math.sin(wave * 2) * 5 * (1 - drop),
                  child: GrabbableParachute(
                    size: mark,
                    color: colors.ink,
                    sway: 0.06 * math.sin(wave) * (1 - drop * 0.7),
                    onHold: _setHolding,
                  ),
                );
              },
            ),
          ],
        );
      },
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({
    required this.colors,
    required this.index,
    required this.story,
    required this.autoplay,
    required this.paused,
    required this.onTogglePause,
  });

  final SceneColors colors;
  final int index;
  final Animation<double> story;
  final bool autoplay;
  final bool paused;
  final VoidCallback onTogglePause;

  @override
  Widget build(BuildContext context) {
    final ink = colors.ink;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screenH,
        AppSpacing.sm,
        AppSpacing.screenH,
        0,
      ),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: StoryProgress(
                  count: _slides.length,
                  index: index,
                  progress: story,
                  color: ink,
                ),
              ),
              if (autoplay)
                IconButton(
                  onPressed: onTogglePause,
                  tooltip: context.tr(
                    paused ? 'jb.onboarding.play' : 'jb.onboarding.pause',
                  ),
                  visualDensity: VisualDensity.compact,
                  icon: Icon(
                    paused ? Icons.play_arrow_rounded : Icons.pause_rounded,
                    color: ink,
                  ),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              SizedBox.square(
                dimension: 28,
                child: CustomPaint(painter: MarkPainter(ink)),
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(
                AppEnv.appName,
                style: AppTextStyles.h3.copyWith(color: ink),
              ),
              const Spacer(),
              LanguageSwitch(ink: ink),
            ],
          ),
        ],
      ),
    );
  }
}

/// Headline and body; slide up into place when their page becomes current.
class _Copy extends StatelessWidget {
  const _Copy({
    required this.slideKey,
    required this.active,
    required this.ink,
  });

  final String slideKey;
  final bool active;
  final Color ink;

  @override
  Widget build(BuildContext context) {
    const enter = Duration(milliseconds: 520);
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screenH,
        AppSpacing.xl,
        AppSpacing.screenH,
        0,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AnimatedSlide(
            offset: active ? Offset.zero : const Offset(0, 0.35),
            duration: enter,
            curve: Curves.easeOutCubic,
            child: AnimatedOpacity(
              opacity: active ? 1 : 0,
              duration: enter,
              child: Text(
                context.tr('jb.onboarding.${slideKey}_title'),
                style: AppTextStyles.display.copyWith(
                  color: ink,
                  fontWeight: FontWeight.w800,
                  height: 1.15,
                ),
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          AnimatedSlide(
            offset: active ? Offset.zero : const Offset(0, 0.6),
            duration: enter,
            curve: const Interval(0.2, 1, curve: Curves.easeOutCubic),
            child: AnimatedOpacity(
              opacity: active ? 1 : 0,
              duration: enter,
              curve: const Interval(0.2, 1),
              child: Text(
                context.tr('jb.onboarding.${slideKey}_body'),
                style: AppTextStyles.bodyLarge.copyWith(
                  color: ink.withValues(alpha: 0.72),
                  height: 1.5,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
