/// One page of a cursor list endpoint: `{ items: T[], nextCursor: string | null }`
/// (e.g. `ClientPage` in `packages/shared/src/schemas/clients.ts`).
/// Pass [nextCursor] back as `?cursor=` for the next page.
class Paginated<T> {
  const Paginated({required this.items, this.nextCursor});

  final List<T> items;
  final String? nextCursor;

  bool get hasMore => nextCursor != null && nextCursor!.isNotEmpty;

  factory Paginated.fromJson(
    Map<String, dynamic> json,
    T Function(Map<String, dynamic>) fromJsonT,
  ) {
    final items = json['items'] as List<dynamic>? ?? const [];
    return Paginated(
      items: items.map((e) => fromJsonT(e as Map<String, dynamic>)).toList(),
      nextCursor: json['nextCursor'] as String?,
    );
  }
}
