import '../../../core/helpers/money.dart';

/// The small Markdown subset of the assistant's answers, parsed in plain
/// Dart (no Markdown package): paragraphs with line breaks, bullet lists
/// (`-`, `*`, `•`), numbered lists (`1.`, `1)`), headings shown bold, and
/// inline `**bold**`, `` `code` `` and `[label](href)`. Anything else stays
/// literal text: no HTML, no image (an answer may repeat a client's name,
/// which could carry Markdown).
sealed class MdBlock {
  const MdBlock(this.spans);
  final List<MdSpan> spans;
}

/// A paragraph; a single newline inside it is a `\n` in its spans.
class MdParagraph extends MdBlock {
  const MdParagraph(super.spans);
}

class MdBullet extends MdBlock {
  const MdBullet(super.spans);
}

class MdNumbered extends MdBlock {
  const MdNumbered(this.number, List<MdSpan> spans) : super(spans);
  final int number;
}

/// A run of text. A link shows its label only: the API already offers the
/// link itself as a chip under the answer.
class MdSpan {
  const MdSpan(this.text, {this.bold = false, this.link = false});
  final String text;
  final bool bold;
  final bool link;

  @override
  bool operator ==(Object other) =>
      other is MdSpan &&
      other.text == text &&
      other.bold == bold &&
      other.link == link;

  @override
  int get hashCode => Object.hash(text, bold, link);

  @override
  String toString() =>
      'MdSpan($text${bold ? ', bold' : ''}${link ? ', link' : ''})';
}

class AssistantMarkdown {
  AssistantMarkdown._();

  static final _bullet = RegExp(r'^\s{0,3}[-*•]\s+(.*)$');
  static final _numbered = RegExp(r'^\s{0,3}(\d{1,3})[.)]\s+(.*)$');
  static final _heading = RegExp(r'^\s{0,3}#{1,6}\s+(.*)$');
  static final _inline = RegExp(
    r'\*\*(.+?)\*\*|`([^`\n]+)`|\[([^\]\n]{1,80})\]\(([^)\s]*)\)',
  );

  static List<MdBlock> parse(String text) {
    final blocks = <MdBlock>[];
    List<String>? paragraph;

    void flush() {
      final lines = paragraph;
      if (lines == null) return;
      final spans = <MdSpan>[];
      for (var i = 0; i < lines.length; i++) {
        if (i > 0) spans.add(const MdSpan('\n'));
        spans.addAll(inline(lines[i]));
      }
      blocks.add(MdParagraph(_merge(spans)));
      paragraph = null;
    }

    for (final raw in text.split(RegExp(r'\r?\n'))) {
      final line = raw.trimRight();
      if (line.trim().isEmpty) {
        flush();
        continue;
      }
      final bullet = _bullet.firstMatch(line);
      if (bullet != null) {
        flush();
        blocks.add(MdBullet(inline(bullet.group(1)!)));
        continue;
      }
      final numbered = _numbered.firstMatch(line);
      if (numbered != null) {
        flush();
        blocks.add(
          MdNumbered(int.parse(numbered.group(1)!), inline(numbered.group(2)!)),
        );
        continue;
      }
      final heading = _heading.firstMatch(line);
      if (heading != null) {
        flush();
        blocks.add(
          MdParagraph([
            for (final s in inline(heading.group(1)!))
              MdSpan(s.text, bold: true, link: s.link),
          ]),
        );
        continue;
      }
      (paragraph ??= []).add(line.trimLeft());
    }
    flush();
    return blocks;
  }

  /// The inline runs of one line; an unclosed `**` stays literal.
  static List<MdSpan> inline(String line) {
    final spans = <MdSpan>[];
    var at = 0;
    for (final m in _inline.allMatches(line)) {
      if (m.start > at) spans.add(MdSpan(line.substring(at, m.start)));
      if (m.group(1) != null) {
        spans.add(MdSpan(m.group(1)!, bold: true));
      } else if (m.group(2) != null) {
        spans.add(MdSpan(m.group(2)!));
      } else {
        spans.add(MdSpan(m.group(3)!, link: true));
      }
      at = m.end;
    }
    if (at < line.length) spans.add(MdSpan(line.substring(at)));
    return _merge(spans);
  }

  /// Joins neighbouring runs of the same style.
  static List<MdSpan> _merge(List<MdSpan> spans) {
    final out = <MdSpan>[];
    for (final s in spans) {
      if (s.text.isEmpty) continue;
      final last = out.isEmpty ? null : out.last;
      if (last != null && last.bold == s.bold && last.link == s.link) {
        out[out.length - 1] = MdSpan(
          last.text + s.text,
          bold: s.bold,
          link: s.link,
        );
      } else {
        out.add(s);
      }
    }
    return out;
  }
}

/// A piece of text: an amount or not.
class TextPart {
  const TextPart(this.text, {required this.amount});
  final String text;
  final bool amount;

  @override
  bool operator ==(Object other) =>
      other is TextPart && other.text == text && other.amount == amount;

  @override
  int get hashCode => Object.hash(text, amount);

  @override
  String toString() => 'TextPart($text, $amount)';
}

/// A number of at least 4 digits or with decimals, or any number followed
/// by a currency (`apps/web/src/components/assistant/split-amounts.ts`).
final _amount = RegExp(
  r'(\d{1,3}(?:\s\d{3})+(?:[,.]\d+)?(?:\s?(?:DA|DZD|دج))?'
  r'|\d+(?:[,.]\d+)?\s?(?:DA|DZD|دج)'
  r'|\d+,\d{2}\b)',
);

/// Cuts a text around its amounts. Inside Arabic, the bidi algorithm would
/// turn `1 234 567,89 DA` into `DA 567,89 234 1`; each amount must be
/// isolated left to right (docs/ui.md). Models write amounts mid-sentence,
/// so the renderer finds them.
List<TextPart> splitAmounts(String text) {
  final parts = <TextPart>[];
  var at = 0;
  for (final m in _amount.allMatches(text)) {
    if (m.start > at) {
      parts.add(TextPart(text.substring(at, m.start), amount: false));
    }
    parts.add(TextPart(m.group(0)!, amount: true));
    at = m.end;
  }
  if (at < text.length) parts.add(TextPart(text.substring(at), amount: false));
  return parts;
}

/// A date as models write it: `2026-11-20`, `20/11/2026`, `20/11`. In
/// Arabic the bidi algorithm turns `2026-11-20` into `20-11-2026`.
final _date = RegExp(r'\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}(?:/\d{2,4})?)\b');

/// [text] with each amount and date kept left to right: wrapped in a
/// left-to-right isolate. An amount's plain spaces become no-break, so it
/// never wraps (the narrow no-break thousands separator stays).
String isolateAmounts(String text) => splitAmounts(text)
    .map(
      (p) => p.amount
          ? '${Money.ltrIsolateStart}'
                '${p.text.replaceAll(RegExp('[ \t]'), Money.currencySpace)}'
                '${Money.ltrIsolateEnd}'
          : p.text.replaceAllMapped(
              _date,
              (m) => '${Money.ltrIsolateStart}${m[0]}${Money.ltrIsolateEnd}',
            ),
    )
    .join();
