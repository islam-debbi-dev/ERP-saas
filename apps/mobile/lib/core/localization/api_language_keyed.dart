import 'package:flutter/widgets.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../network/api_language.dart';
import '../session/session_cubit.dart';
import 'locale_cubit.dart';

/// Rebuilds [child] from scratch when the language the backend localizes
/// into changes, so tabs kept alive by the shell refetch their `name`s.
///
/// The backend prefers the signed-in user's `preferredLanguage` over
/// `Accept-Language`, and that is synced asynchronously after a switch — so
/// key on it (not the app locale) to avoid refetching before it lands.
class ApiLanguageKeyed extends StatelessWidget {
  const ApiLanguageKeyed({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final preferred = context.select(
      (SessionCubit c) => c.state.user?.preferredLanguage,
    );
    final appLang = context.select(
      (LocaleCubit c) =>
          ApiLanguage.fromLocaleCode(c.state.locale.languageCode),
    );
    return KeyedSubtree(key: ValueKey(preferred ?? appLang), child: child);
  }
}
