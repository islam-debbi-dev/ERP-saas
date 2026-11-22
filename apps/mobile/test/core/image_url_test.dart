import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/models/media_ref.dart';
import 'package:orvynt_starter/core/network/image_url.dart';

void main() {
  const id = '6ad25954ab7683b36909a66a';

  test('resolve keeps absolute URLs and drops empty ones', () {
    expect(ImageUrl.resolve(null), isNull);
    expect(ImageUrl.resolve('  '), isNull);
    expect(
      ImageUrl.resolve('https://cdn.example/a.jpg'),
      'https://cdn.example/a.jpg',
    );
  });

  test('sized swaps the variant of optimized URLs only', () {
    expect(
      ImageUrl.sized('http://10.0.2.2:5001/media/$id/large', ImageSize.thumb),
      'http://10.0.2.2:5001/media/$id/thumb',
    );
    const legacy = 'http://localhost:5001/uploads/jibli/products/a.jpg';
    expect(ImageUrl.sized(legacy, ImageSize.thumb), legacy);
  });

  test('picks the smallest variant that covers the slot', () {
    expect(ImageSize.forPixels(68 * 3), ImageSize.small); // cart line @3x
    expect(ImageSize.forPixels(48 * 2), ImageSize.thumb); // order item @2x
    expect(ImageSize.forPixels(170 * 3), ImageSize.medium); // grid card @3x
    expect(ImageSize.forPixels(430 * 3), ImageSize.large); // full width @3x
  });

  test('MediaRef falls back to the nearest available size', () {
    final media = MediaRef.fromJson({
      'id': id,
      'width': 64,
      'height': 48,
      'blurDataUrl': 'data:image/webp;base64,AAAA',
      'urls': {'thumb': 't', 'small': 's'},
    });
    expect(media.urlFor(ImageSize.thumb), 't');
    expect(media.urlFor(ImageSize.large), 's');
    expect(media.aspectRatio, closeTo(1.333, 0.001));
  });
}
