import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter/material.dart';

class SvgHelper {
  static Widget loadSvgAsset(
    String assetName, {
    double? width,
    double? height,
    Color? color,
    BoxFit fit = BoxFit.contain,
  }) {
    return SvgPicture.asset(
      assetName,
      width: width,
      height: height,
      colorFilter: color != null
          ? ColorFilter.mode(color, BlendMode.srcIn)
          : null,
      fit: fit,
      // Suppress warnings for unsupported SVG elements
      semanticsLabel: assetName,
    );
  }
}
