/// One page of a list endpoint:
/// `{ success, data: T[], meta: { page, limit, total, totalPages } }`.
class Paginated<T> {
  final List<T> items;
  final int page;
  final int limit;
  final int total;
  final int totalPages;

  const Paginated({
    required this.items,
    required this.page,
    required this.limit,
    required this.total,
    required this.totalPages,
  });

  bool get hasMore => page < totalPages;

  factory Paginated.fromJson(
    Map<String, dynamic> json,
    T Function(Map<String, dynamic>) fromJsonT,
  ) {
    final meta = json['meta'] as Map<String, dynamic>? ?? const {};
    final data = json['data'] as List<dynamic>? ?? const [];
    return Paginated(
      items: data.map((e) => fromJsonT(e as Map<String, dynamic>)).toList(),
      page: (meta['page'] as num?)?.toInt() ?? 1,
      limit: (meta['limit'] as num?)?.toInt() ?? data.length,
      total: (meta['total'] as num?)?.toInt() ?? data.length,
      totalPages: (meta['totalPages'] as num?)?.toInt() ?? 1,
    );
  }
}
