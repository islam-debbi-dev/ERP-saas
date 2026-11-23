import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart' as url_launcher;

import '../../../../core/config/app_env.dart';
import '../../../../core/design/design.dart';
import '../../../../core/helpers/text_direction.dart';
import '../../../../core/localization/tr.dart';
import '../../../../core/session/session_cubit.dart';
import '../../../orders/ui/my_orders_screen.dart' show OrderDetailScreen;
import '../../../sales/ui/my_sales_screen.dart' show SaleDetailScreen;
import '../../data/assistant_models.dart';
import '../../logic/assistant_links.dart';

/// Opens a URL outside the app (the dashboard in the browser).
typedef UrlOpener = Future<bool> Function(Uri url);

Future<bool> _openExternal(Uri url) => url_launcher.launchUrl(
  url,
  mode: url_launcher.LaunchMode.externalApplication,
);

/// The links offered with an answer, as chips: an app screen when the role
/// has one (see [AssistantLinks]), else the dashboard in the browser
/// (marked with an "open outside" icon). A link that cannot be followed
/// shows no chip.
class AnswerLinks extends StatelessWidget {
  const AnswerLinks({
    super.key,
    required this.links,
    this.dashboardUrl,
    this.openUrl = _openExternal,
  });

  final List<AssistantLink> links;

  /// `DASHBOARD_URL` of the env unless a test gives one.
  final String? dashboardUrl;
  final UrlOpener openUrl;

  @override
  Widget build(BuildContext context) {
    final user = context.watch<SessionCubit>().state.user;
    if (user == null) return const SizedBox.shrink();
    final dashboard = dashboardUrl ?? AppEnv.dashboardUrl;
    final chips = <Widget>[
      for (final link in links)
        if (AssistantLinks.resolve(link.href, user, dashboardUrl: dashboard)
            case final target?)
          _chip(context, link, target),
    ];
    if (chips.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.sm),
      child: Wrap(
        spacing: AppSpacing.sm,
        runSpacing: AppSpacing.sm,
        children: chips,
      ),
    );
  }

  Widget _chip(BuildContext context, AssistantLink link, LinkTarget target) {
    final web = target is WebTarget;
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: AppSpacing.minTouch),
      child: ActionChip(
        avatar: Icon(web ? Icons.open_in_new : Icons.arrow_forward, size: 18),
        tooltip: web ? context.tr('assistant.open_in_browser') : null,
        label: Text(
          link.label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          textDirection: textDirectionOf(
            link.label,
            fallback: Directionality.of(context),
          ),
        ),
        onPressed: () => _open(context, target),
      ),
    );
  }

  Future<void> _open(BuildContext context, LinkTarget target) async {
    switch (target) {
      case AppRouteTarget(:final path, :final inChatTab):
        if (inChatTab) {
          await context.push(path);
        } else {
          context.go(path);
        }
      case SalePageTarget(:final saleId):
        await Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => SaleDetailScreen(saleId: saleId),
          ),
        );
      case OrderPageTarget(:final orderId):
        await Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => OrderDetailScreen(orderId: orderId),
          ),
        );
      case WebTarget(:final url):
        await openUrl(url);
    }
  }
}
