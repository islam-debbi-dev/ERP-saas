import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'connectivity_reachability.dart';
import 'constants.dart';

/// Network **link-type** discovery for UX (banner, “you appear offline”), not proof of
/// internet access — see the `connectivity_plus` package docs: always handle timeouts/errors in Dio/API
/// code; Wi‑Fi can exist without internet (captive portal, hotel Wi‑Fi, etc.).
///
/// Implements the plugin’s usage pattern (`contains` on [ConnectivityResult]) for
/// “has a network interface”; combines:
/// - [Connectivity.onConnectivityChanged] (distinct emissions on the stream)
/// - [Connectivity.checkConnectivity] on [AppLifecycleState.resumed] — **required on Android
///   8+**, where connectivity broadcasts are unreliable when the app is not in foreground.
/// - Polling while the plugin reports no link, plus an optional DNS-based probe when the
///   OS lags updating radio / capability state (common after toggling Wi‑Fi).
///
/// **iOS simulators:** Wi‑Fi changes may not update the stream (plugin docs). **iOS path
/// monitor:** can emit `none` then `wifi` in quick succession; treat as best-effort signals.
class ConnectivityService with WidgetsBindingObserver {
  final ValueNotifier<bool> isOffline = ValueNotifier(false);
  StreamSubscription<List<ConnectivityResult>>? _subscription;
  VoidCallback? _onReconnect;
  Timer? _offlinePollTimer;
  bool _lifecycleRegistered = false;

  /// Discards stale async results when a newer connectivity check started.
  int _applyGeneration = 0;

  static const _offlinePollInterval = Duration(seconds: 2);
  static const _reachabilityTimeout = Duration(seconds: 4);

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // connectivity_plus: from Android O, refresh when resumed — broadcasts are not
    // reliable while the app is in the background.
    if (state == AppLifecycleState.resumed) {
      unawaited(_refreshFromPlatform());
    }
  }

  /// Pass a function that will be called when internet is restored
  Future<void> init({VoidCallback? onReconnect}) async {
    _onReconnect = onReconnect;

    await _subscription?.cancel();
    _subscription = null;

    if (!_lifecycleRegistered) {
      WidgetsBinding.instance.addObserver(this);
      _lifecycleRegistered = true;
    }

    await _refreshFromPlatform();

    debugPrint(
      '🔌 Connectivity Service Initialized - Offline: ${isOffline.value}',
    );

    _subscription = Connectivity().onConnectivityChanged.listen(
      (results) => unawaited(_applyConnectivityResults(results)),
      onError: (_) {
        debugPrint('⚠️ Connectivity Check Error');
        isOffline.value = false;
        ConnectivityState.isOffline = false;
        _syncOfflinePoll(false);
      },
    );
  }

  /// Approximate “can resolve a host” check — **not** a substitute for API error handling;
  /// helps when [checkConnectivity] still reports [ConnectivityResult.none] while a route
  /// is already usable.
  Future<bool> _probeReachability() async {
    if (kIsWeb) return false;
    return connectivityProbeReachability(timeout: _reachabilityTimeout);
  }

  /// Calls [Connectivity.checkConnectivity] and applies the outcome (same path
  /// as stream events, including reconnect callback when leaving offline).
  Future<void> _refreshFromPlatform() async {
    try {
      final List<ConnectivityResult> results =
          await Connectivity().checkConnectivity();
      await _applyConnectivityResults(results);
    } on PlatformException {
      debugPrint('⚠️ Platform Exception during connectivity check');
      isOffline.value = false;
      ConnectivityState.isOffline = false;
      _syncOfflinePoll(false);
    } catch (e) {
      debugPrint('⚠️ Error during connectivity check: $e');
      isOffline.value = false;
      ConnectivityState.isOffline = false;
      _syncOfflinePoll(false);
    }
  }

  Future<void> _applyConnectivityResults(
    List<ConnectivityResult> results,
  ) async {
    final gen = ++_applyGeneration;
    var offline = _isOffline(results);

    if (offline) {
      final reachable = await _probeReachability();
      if (gen != _applyGeneration) return;
      if (reachable) {
        offline = false;
        debugPrint(
          '📶 Online (reachability probe; plugin still reported disconnected)',
        );
      }
    } else {
      if (gen != _applyGeneration) return;
    }

    _commitConnectivityState(offline, results);
  }

  void _commitConnectivityState(
    bool offline,
    List<ConnectivityResult> results,
  ) {
    final wasOffline = isOffline.value;

    if (wasOffline == offline) {
      _syncOfflinePoll(offline);
      return;
    }

    isOffline.value = offline;
    ConnectivityState.isOffline = offline;

    if (offline) {
      debugPrint('❌ No network link (plugin) ($results)');
    } else {
      debugPrint('✅ Network link present per plugin ($results)');
    }

    if (wasOffline && !offline) {
      Connectionresfrech.resfrechAfterconn = true;
      _onReconnect?.call();
    }

    _syncOfflinePoll(offline);

    // [Timer.periodic] waits a full interval before the first tick — nudge one
    // extra check shortly after we *become* offline (radio / validation lag).
    if (offline && !wasOffline) {
      unawaited(
        Future<void>.delayed(const Duration(milliseconds: 400), () {
          if (isOffline.value) unawaited(_refreshFromPlatform());
        }),
      );
    }
  }

  void _syncOfflinePoll(bool offline) {
    if (offline) {
      _offlinePollTimer ??= Timer.periodic(
        _offlinePollInterval,
        (_) => unawaited(_refreshFromPlatform()),
      );
    } else {
      _offlinePollTimer?.cancel();
      _offlinePollTimer = null;
    }
  }

  /// Same rule as the README: “no available network types” ↔ list contains only
  /// [ConnectivityResult.none] (the plugin does not mix `none` with other types).
  /// Any other [ConnectivityResult] means some link is present — not guaranteed to be
  /// the public internet (captive portal, etc.); still handle API failures/timeouts.
  bool _isOffline(List<ConnectivityResult> results) {
    if (results.isEmpty) return true;
    return results.every((r) => r == ConnectivityResult.none);
  }

  void dispose() {
    _offlinePollTimer?.cancel();
    _offlinePollTimer = null;
    _subscription?.cancel();
    _subscription = null;
    if (_lifecycleRegistered) {
      WidgetsBinding.instance.removeObserver(this);
      _lifecycleRegistered = false;
    }
    isOffline.dispose();
  }

  /// Check current connectivity status and log to console
  Future<void> logCurrentStatus() async {
    try {
      final List<ConnectivityResult> results =
          await Connectivity().checkConnectivity();
      final offline = _isOffline(results);

      debugPrint('📊 Current Connectivity Status:');
      debugPrint('   - Offline (plugin): $offline');
      debugPrint('   - Connection Type: $results');
      debugPrint('   - isOffline ValueNotifier: ${isOffline.value}');
      if (offline && !kIsWeb) {
        debugPrint(
          '   - Reachability probe: ${await connectivityProbeReachability(timeout: _reachabilityTimeout)}',
        );
      }
    } catch (e) {
      debugPrint('❌ Error checking connectivity: $e');
    }
  }
}
