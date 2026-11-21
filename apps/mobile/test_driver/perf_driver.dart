// Host side of the scroll benchmark: turns the timeline recorded by
// `integration_test/home_feed_scroll_perf_test.dart` into a summary.
//
//   flutter drive --profile --driver=test_driver/perf_driver.dart \
//     --target=integration_test/home_feed_scroll_perf_test.dart \
//     --dart-define=API_BASE_URL=http://10.0.2.2:5001/api/v1
//
// Writes `build/home_feed_scroll.timeline.json` and
// `build/home_feed_scroll.timeline_summary.json`, and prints the numbers.
import 'dart:convert';

import 'package:flutter_driver/flutter_driver.dart' as driver;
import 'package:integration_test/integration_test_driver.dart';

const _key = 'home_feed_scroll';

Future<void> main() => integrationDriver(
  responseDataCallback: (data) async {
    final raw = data?[_key];
    if (raw is! Map<String, dynamic>) return;
    final summary = driver.TimelineSummary.summarize(
      driver.Timeline.fromJson(raw),
    );
    await summary.writeTimelineToFile(_key, pretty: true);

    final json = summary.summaryJson;
    // Per-frame times in microseconds; a frame is janky when its build or
    // its raster misses the 60 Hz budget.
    final build = [...(json['frame_build_times'] as List).cast<num>()];
    final raster = [...(json['frame_rasterizer_times'] as List).cast<num>()];
    const budget = 16667;
    final janky = [
      for (var i = 0; i < build.length; i++)
        if (build[i] > budget || (i < raster.length && raster[i] > budget)) i,
    ].length;
    String ms(num v) => v.toStringAsFixed(2);
    final picked = {
      'frames': build.length,
      'build_p50': ms(summary.computePercentileFrameBuildTimeMillis(50)),
      'build_p90': ms(summary.computePercentileFrameBuildTimeMillis(90)),
      'build_p99': ms(summary.computePercentileFrameBuildTimeMillis(99)),
      'build_worst': ms(summary.computeWorstFrameBuildTimeMillis()),
      'raster_p50': ms(summary.computePercentileFrameRasterizerTimeMillis(50)),
      'raster_p90': ms(summary.computePercentileFrameRasterizerTimeMillis(90)),
      'raster_p99': ms(summary.computePercentileFrameRasterizerTimeMillis(99)),
      'raster_worst': ms(summary.computeWorstFrameRasterizerTimeMillis()),
      'missed_build_budget': json['missed_frame_build_budget_count'],
      'missed_raster_budget': json['missed_frame_rasterizer_budget_count'],
      'janky_frames': janky,
      'janky_percent': build.isEmpty ? '0' : ms(janky * 100 / build.length),
      'new_gen_gc': json['new_gen_gc_count'],
      'old_gen_gc': json['old_gen_gc_count'],
    };
    // ignore: avoid_print
    print(
      'HOME_FEED_SCROLL ${const JsonEncoder.withIndent('  ').convert(picked)}',
    );
  },
);
