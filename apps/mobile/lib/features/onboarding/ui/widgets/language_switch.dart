import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/design/design.dart';
import '../../../../core/localization/locale_cubit.dart';

/// Compact EN / عربي segmented pill. Each language is written in its
/// own script so people find theirs without reading the current one.
class LanguageSwitch extends StatelessWidget {
  const LanguageSwitch({super.key, required this.ink});

  /// Foreground of the screen it sits on (ink on yellow, yellow on dark).
  final Color ink;

  static const _languages = [
    ('en', 'EN', 'English'),
    ('ar', 'عربي', 'العربية'),
  ];

  @override
  Widget build(BuildContext context) {
    final current = context.select(
      (LocaleCubit c) => c.state.locale.languageCode,
    );
    final onInk = context.isDarkMode ? AppColors.ink : AppColors.yellow;
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: ink.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final (code, label, name) in _languages)
            Semantics(
              button: true,
              selected: code == current,
              label: name,
              excludeSemantics: true,
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: code == current
                    ? null
                    : () {
                        HapticFeedback.selectionClick();
                        context.read<LocaleCubit>().switchLocale(Locale(code));
                      },
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 220),
                  curve: Curves.easeOut,
                  constraints: const BoxConstraints(
                    minWidth: 44,
                    minHeight: 34,
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: code == current ? ink : Colors.transparent,
                    borderRadius: BorderRadius.circular(17),
                  ),
                  child: Text(
                    label,
                    style: AppTextStyles.label.copyWith(
                      color: code == current ? onInk : ink,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
