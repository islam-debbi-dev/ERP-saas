String formatViews(dynamic views) {
  if (views is String) {
    views = double.tryParse(views) ?? 0;
  }

  if (views < 1000) {
    return views.toStringAsFixed(0);
  } else if (views < 1000000) {
    double value = views / 1000;
    String result = value.toStringAsFixed(1);
    // remove trailing .0 or decimal if not needed
    result = result.endsWith('.0')
        ? result.split('.0').first
        : result.split('.')[0];
    return '${result}K';
  } else if (views < 1000000000) {
    double value = views / 1000000;
    String result = value.toStringAsFixed(1);
    result = result.endsWith('.0')
        ? result.split('.0').first
        : result.split('.')[0];
    return '${result}M';
  } else {
    double value = views / 1000000000;
    String result = value.toStringAsFixed(1);
    result = result.endsWith('.0')
        ? result.split('.0').first
        : result.split('.')[0];
    return '${result}B';
  }
}
