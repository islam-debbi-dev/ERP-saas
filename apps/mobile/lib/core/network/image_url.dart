import '../config/app_env.dart';

/// Variants served by `GET /media/:id/:size` (widths 150 / 320 / 640 / 1280).
enum ImageSize {
  thumb(150),
  small(320),
  medium(640),
  large(1280);

  const ImageSize(this.width);

  /// Pixel width of the variant (the backend never upscales).
  final int width;

  /// Smallest variant at least [pixels] wide, so the slot is never blurry
  /// and never pays for a much bigger file than it shows.
  static ImageSize forPixels(double pixels) {
    for (final size in values) {
      if (pixels <= size.width) return size;
    }
    return large;
  }
}

/// Image URL helpers shared by every image widget.
class ImageUrl {
  ImageUrl._();

  static final _mediaPath = RegExp(r'/media/([a-f0-9]{24})/[a-z]+$');

  /// `null` for empty values; absolute URLs as-is; relative paths
  /// (`/media/...`, `/uploads/...`) prefixed with the API origin. The backend
  /// already returns absolute URLs — this is the safety net.
  static String? resolve(String? raw) {
    final value = raw?.trim() ?? '';
    if (value.isEmpty) return null;
    if (value.startsWith('http://') || value.startsWith('https://')) return value;
    if (value.startsWith('data:')) return value;
    final origin = Uri.parse(AppEnv.apiBaseUrl).origin;
    return value.startsWith('/') ? '$origin$value' : '$origin/$value';
  }

  /// Same image at another size when [url] is an optimized `/media/<id>/…`
  /// URL (order items, avatars, store summaries only carry the URL). Legacy
  /// `/uploads/...` files have a single size and are returned unchanged.
  static String? sized(String? url, ImageSize size) {
    final resolved = resolve(url);
    if (resolved == null) return null;
    final uri = Uri.tryParse(resolved);
    if (uri == null || !_mediaPath.hasMatch(uri.path)) return resolved;
    final path = uri.path.replaceFirst(RegExp(r'[a-z]+$'), size.name);
    return uri.replace(path: path).toString();
  }
}
