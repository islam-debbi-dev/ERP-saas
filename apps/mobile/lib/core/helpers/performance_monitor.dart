import 'dart:async';
import 'dart:developer' as developer;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Performance monitoring utility for tracking app performance
class PerformanceMonitor {
  static final PerformanceMonitor _instance = PerformanceMonitor._internal();
  factory PerformanceMonitor() => _instance;
  PerformanceMonitor._internal();

  final Map<String, Stopwatch> _timers = {};
  final Map<String, List<double>> _frameRates = {};
  final Map<String, int> _memoryUsage = {};

  /// Start timing a specific operation
  void startTimer(String operationName) {
    _timers[operationName] = Stopwatch()..start();
    if (kDebugMode) {
      developer.log('⏱️ Started timer: $operationName',
          name: 'PerformanceMonitor');
    }
  }

  /// End timing and log the result
  void endTimer(String operationName) {
    final timer = _timers[operationName];
    if (timer != null) {
      timer.stop();
      final duration = timer.elapsedMilliseconds;
      if (kDebugMode) {
        developer.log('⏱️ $operationName took ${duration}ms',
            name: 'PerformanceMonitor');
      }
      _timers.remove(operationName);
    }
  }

  /// Track frame rate for a specific widget
  void trackFrameRate(String widgetName, double fps) {
    if (!_frameRates.containsKey(widgetName)) {
      _frameRates[widgetName] = [];
    }
    _frameRates[widgetName]!.add(fps);

    // Keep only last 100 measurements
    if (_frameRates[widgetName]!.length > 100) {
      _frameRates[widgetName]!.removeAt(0);
    }
  }

  /// Get average frame rate for a widget
  double getAverageFrameRate(String widgetName) {
    final rates = _frameRates[widgetName];
    if (rates == null || rates.isEmpty) return 0.0;

    final sum = rates.reduce((a, b) => a + b);
    return sum / rates.length;
  }

  /// Track memory usage
  void trackMemoryUsage(String operation, int bytes) {
    _memoryUsage[operation] = bytes;
    if (kDebugMode) {
      developer.log(
          '💾 Memory usage for $operation: ${(bytes / 1024 / 1024).toStringAsFixed(2)}MB',
          name: 'PerformanceMonitor');
    }
  }

  /// Get performance report
  Map<String, dynamic> getPerformanceReport() {
    final report = <String, dynamic>{
      'frameRates': {},
      'memoryUsage': _memoryUsage,
      'activeTimers': _timers.length,
    };

    for (final entry in _frameRates.entries) {
      report['frameRates'][entry.key] = {
        'average': getAverageFrameRate(entry.key),
        'min': entry.value.isNotEmpty
            ? entry.value.reduce((a, b) => a < b ? a : b)
            : 0.0,
        'max': entry.value.isNotEmpty
            ? entry.value.reduce((a, b) => a > b ? a : b)
            : 0.0,
        'samples': entry.value.length,
      };
    }

    return report;
  }

  /// Log performance report
  void logPerformanceReport() {
    if (!kDebugMode) return;

    final report = getPerformanceReport();
    developer.log('📊 Performance Report:', name: 'PerformanceMonitor');
    developer.log('Frame Rates: ${report['frameRates']}',
        name: 'PerformanceMonitor');
    developer.log('Memory Usage: ${report['memoryUsage']}',
        name: 'PerformanceMonitor');
    developer.log('Active Timers: ${report['activeTimers']}',
        name: 'PerformanceMonitor');
  }

  /// Clear all data
  void clear() {
    _timers.clear();
    _frameRates.clear();
    _memoryUsage.clear();
  }
}

/// Extension for easy performance monitoring
extension PerformanceExtension on Widget {
  Widget withPerformanceMonitoring(String widgetName, {bool enable = true}) {
    if (!kDebugMode || !enable) return this;

    return _PerformanceWidget(
      widgetName: widgetName,
      child: this,
    );
  }
}

/// Widget wrapper for performance monitoring
class _PerformanceWidget extends StatefulWidget {
  final Widget child;
  final String widgetName;

  const _PerformanceWidget({
    required this.child,
    required this.widgetName,
  });

  @override
  State<_PerformanceWidget> createState() => _PerformanceWidgetState();
}

class _PerformanceWidgetState extends State<_PerformanceWidget> {
  final PerformanceMonitor _monitor = PerformanceMonitor();
  Timer? _frameTimer;
  int _frameCount = 0;

  @override
  void initState() {
    super.initState();
    if (kDebugMode) {
      _startFrameRateMonitoring();
    }
  }

  @override
  void dispose() {
    _frameTimer?.cancel();
    super.dispose();
  }

  void _startFrameRateMonitoring() {
    _frameTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      final fps = _frameCount / 1.0; // 1 second interval
      _monitor.trackFrameRate(widget.widgetName, fps);

      if (fps < 30) {
        developer.log(
            '⚠️ Low frame rate detected for ${widget.widgetName}: ${fps.toStringAsFixed(1)} FPS',
            name: 'PerformanceMonitor');
      }

      _frameCount = 0;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (kDebugMode) {
      _frameCount++;
    }

    return widget.child;
  }
}
