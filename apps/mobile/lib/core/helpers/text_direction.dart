import 'package:flutter/widgets.dart';

/// The direction of free text, like HTML `dir="auto"`: the first strong
/// letter decides. Arabic (and other right-to-left scripts) → RTL; a Latin
/// letter → LTR; no letter at all (digits only, empty) → [fallback].
TextDirection textDirectionOf(String text, {TextDirection? fallback}) {
  for (final rune in text.runes) {
    if (_isRtl(rune)) return TextDirection.rtl;
    if (_isLtr(rune)) return TextDirection.ltr;
  }
  return fallback ?? TextDirection.ltr;
}

bool _isRtl(int c) =>
    (c >= 0x0590 && c <= 0x08FF) || // Hebrew, Arabic, Syriac, Thaana...
    (c >= 0xFB1D && c <= 0xFDFF) || // presentation forms A
    (c >= 0xFE70 && c <= 0xFEFF); // presentation forms B

bool _isLtr(int c) =>
    (c >= 0x41 && c <= 0x5A) ||
    (c >= 0x61 && c <= 0x7A) ||
    (c >= 0xC0 && c <= 0x024F && c != 0xD7 && c != 0xF7);
