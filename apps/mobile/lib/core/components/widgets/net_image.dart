import 'dart:convert';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../design/design.dart';
import '../logo/debvora_logo.dart';
import '../../models/media_ref.dart';
import '../../network/image_url.dart';

/// Network image sized for its slot.
///
/// * Optimized images ([media], or any `/media/<id>/…` [url]) are requested at
///   the smallest variant covering the slot's physical width (or [size]).
/// * Decoding is capped to the slot (`memCacheWidth`), so a big photo never
///   sits in RAM at full resolution.
/// * The blur placeholder (`media.blurDataUrl`) shows while loading; images
///   without one get the pulsing image placeholder. Empty or broken URLs fall back to a
///   neutral icon (catalog items without a photo yet) and log why in debug.
/// * Non-cover fits (e.g. `BoxFit.contain` for product photos, shown uncropped)
///   sit on the neutral field color.
/// * The photo lands with one 180 ms crossfade: it is drawn at once under the
///   placeholder, which fades out. One fading layer per image, not two (the
///   package default also kept the placeholder fading for a full second).
class NetImage extends StatelessWidget {
  const NetImage({
    super.key,
    required this.url,
    this.media,
    this.size,
    this.fit = BoxFit.cover,
    this.placeholderIcon = Icons.shopping_basket_outlined,
    this.emoji,
    this.desaturate = false,
  });

  final String? url;
  final MediaRef? media;

  /// Forces a variant (e.g. `large` for the zoomable gallery); otherwise it
  /// is picked from the laid-out width × device pixel ratio.
  final ImageSize? size;
  final BoxFit fit;
  final IconData placeholderIcon;

  /// Shown instead of [placeholderIcon] when set (category icons).
  final String? emoji;

  /// Draws the photo at about 60 % saturation (a closed store). Applied as
  /// the image's own colour filter, so it costs no extra layer, unlike a
  /// `ColorFiltered` ancestor.
  final bool desaturate;

  /// Grey at 40 % in `saturation` mode keeps ≈ 60 % of the colour.
  static const _desaturateColor = AppColors.desaturate;

  static const _fade = Duration(milliseconds: 180);

  /// Warms the image cache for a slot of [slotSize] logical pixels (cover
  /// fit), with the same URL and decode size a [NetImage] in that slot will
  /// ask for, so it shows at once. Used for the next cards of a feed.
  static Future<void> precache(
    BuildContext context, {
    required String? url,
    MediaRef? media,
    required Size slotSize,
  }) {
    final image = NetImage(url: url, media: media);
    final pixels = image._neededPixels(context, BoxConstraints.tight(slotSize));
    final src = image._source(pixels);
    if (src == null) return Future.value();
    return precacheImage(
      ResizeImage.resizeIfNeeded(
        pixels,
        null,
        CachedNetworkImageProvider(src, headers: _headers),
      ),
      context,
      onError: (_, _) {},
    );
  }

  /// WebP decodes on every Flutter platform and is ~40% smaller than JPEG;
  /// the server falls back to JPEG for clients that don't list it.
  static const _headers = {'Accept': 'image/webp,image/jpeg;q=0.8,*/*;q=0.5'};

  @override
  Widget build(BuildContext context) {
    final fallback = _Fallback(icon: placeholderIcon, emoji: emoji);
    if (ImageUrl.resolve(media?.urlFor(ImageSize.large) ?? url) == null) {
      return fallback;
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final pixels = _neededPixels(context, constraints);
        final src = _source(pixels)!;
        final tint = desaturate ? _desaturateColor : null;
        final blend = desaturate ? BlendMode.saturation : null;

        final image = CachedNetworkImage(
          imageUrl: src,
          httpHeaders: _headers,
          fit: fit,
          color: tint,
          colorBlendMode: blend,
          // Decode at the slot's physical width (never wider than the file).
          memCacheWidth: pixels,
          fadeInDuration: Duration.zero,
          fadeOutDuration: _fade,
          placeholder: (_, _) => _Placeholder(
            blurDataUrl: media?.blurDataUrl,
            fit: fit,
            color: tint,
            colorBlendMode: blend,
          ),
          errorWidget: (_, failedUrl, error) {
            if (kDebugMode) debugPrint('NetImage failed: $failedUrl → $error');
            return fallback;
          },
        );
        // Letterboxed fits leave bands around the photo; tint them so the
        // whole slot reads as one frame.
        return fit == BoxFit.cover
            ? image
            : ColoredBox(color: context.fieldFill, child: image);
      },
    );
  }
}

/// Physical pixel width the image must have to fill the slot. With
/// `BoxFit.cover` a slot taller than the image's ratio needs extra width
/// (the sides get cropped), so the ratio is taken into account; unknown
/// ratios assume a 3:2 landscape photo, which over- rather than under-shoots.
extension on NetImage {
  /// URL of the smallest variant covering [pixels] (or the forced [size]).
  String? _source(int? pixels) {
    final variant =
        size ??
        (pixels == null
            ? ImageSize.medium
            : ImageSize.forPixels(pixels.toDouble()));
    return ImageUrl.resolve(media?.urlFor(variant)) ??
        ImageUrl.sized(url, variant);
  }

  int? _neededPixels(BuildContext context, BoxConstraints constraints) {
    if (!constraints.hasBoundedWidth) return null;
    var width = constraints.maxWidth;
    if (fit == BoxFit.cover && constraints.hasBoundedHeight) {
      final ratio = media?.aspectRatio ?? 1.5;
      width = width > constraints.maxHeight * ratio
          ? width
          : constraints.maxHeight * ratio;
    }
    return (width * MediaQuery.devicePixelRatioOf(context)).ceil();
  }
}

/// Blur-up placeholder from the backend's 20px LQIP, or the image placeholder.
class _Placeholder extends StatelessWidget {
  const _Placeholder({
    this.blurDataUrl,
    required this.fit,
    this.color,
    this.colorBlendMode,
  });

  final String? blurDataUrl;
  final BoxFit fit;
  final Color? color;
  final BlendMode? colorBlendMode;

  /// Decoded LQIPs, keyed by data URL (they are tiny and reused in lists).
  static final _cache = <String, Uint8List?>{};

  static Uint8List? _decode(String dataUrl) => _cache.putIfAbsent(dataUrl, () {
    final comma = dataUrl.indexOf(',');
    if (!dataUrl.startsWith('data:') || comma < 0) return null;
    try {
      return base64Decode(dataUrl.substring(comma + 1));
    } on FormatException {
      return null;
    }
  });

  @override
  Widget build(BuildContext context) {
    final bytes = blurDataUrl == null ? null : _decode(blurDataUrl!);
    if (bytes == null) {
      return ImagePlaceholder(background: context.fieldFill);
    }
    return Image.memory(
      bytes,
      fit: fit,
      gaplessPlayback: true,
      color: color,
      colorBlendMode: colorBlendMode,
      // Smooth upscale of the 20px preview reads as a blur.
      filterQuality: FilterQuality.medium,
      errorBuilder: (_, _, _) =>
          ImagePlaceholder(background: context.fieldFill),
    );
  }
}

class _Fallback extends StatelessWidget {
  const _Fallback({required this.icon, this.emoji});

  final IconData icon;
  final String? emoji;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: context.fieldFill,
      child: Center(
        child: emoji != null && emoji!.isNotEmpty
            ? Text(emoji!, style: const TextStyle(fontSize: 34))
            : Icon(icon, size: 34, color: context.textFaint),
      ),
    );
  }
}
