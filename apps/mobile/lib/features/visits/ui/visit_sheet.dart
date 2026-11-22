import 'package:flutter/material.dart';

import '../../../core/components/widgets/text_prompt.dart';
import '../../../core/di/dependency_injection.dart';
import '../../../core/design/design.dart';
import '../../../core/geo/geo_capture.dart';
import '../../../core/geo/geo_fix.dart';
import '../../../core/localization/tr.dart';
import '../../../core/network/api_error.dart';
import '../../../core/network/api_result.dart';
import '../../../core/network/error_messages.dart';
import '../../../core/network/idempotency_key.dart';
import '../../../core/network/money_action.dart';
import '../../auth/ui/widgets/form_error_banner.dart';
import '../data/visits_repository.dart';
import '../logic/visit_form.dart';

/// "Terminer la visite": the outcome, linked to the document made during the
/// visit, or NO_SALE with a reason (OTHER needs a note), GPS, `POST /visits`.
/// Pops with the saved visit.
Future<VisitSaved?> showVisitSheet(
  BuildContext context, {
  required String clientId,
  required VisitStart start,
  required VisitDocs docs,
}) => showModalBottomSheet<VisitSaved>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (_) => VisitSheet(clientId: clientId, start: start, docs: docs),
);

class VisitSheet extends StatefulWidget {
  const VisitSheet({
    super.key,
    required this.clientId,
    required this.start,
    required this.docs,
  });

  final String clientId;
  final VisitStart start;
  final VisitDocs docs;

  @override
  State<VisitSheet> createState() => _VisitSheetState();
}

class _VisitSheetState extends State<VisitSheet> {
  /// Created when the sheet opens, reused on every retry of this visit.
  final _key = IdempotencyKey();
  late VisitForm _form = VisitForm(
    clientId: widget.clientId,
    start: widget.start,
    docs: widget.docs,
    outcome: widget.docs.suggestedOutcome,
  );
  bool _busy = false;
  bool _showErrors = false;
  ApiError? _error;
  GeoFix? _fix;
  bool _located = false;

  Future<void> _save() async {
    if (_busy) return;
    if (_form.errors.isNotEmpty) {
      setState(() => _showErrors = true);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    // One position per visit: a retry sends the same one.
    if (!_located) {
      _fix = await captureGeo(context);
      _located = true;
    }
    if (!mounted) return;
    final repo = getIt<VisitsRepository>();
    final runner = MoneyActionRunner(
      askGeoNote: (error) => askText(
        context,
        title: context.tr('geo.note_title'),
        message: apiErrorText(context, error),
        label: context.tr('geo.note_label'),
        minLength: 3,
        confirmLabel: context.tr('geo.note_send'),
      ),
    );
    final result = await runner.run(
      _key,
      (k, note) => repo.create(
        _form.toJson(
          endedAt: DateTime.now(),
          geo: geoInputJson(_fix, note: note),
        ),
        k,
      ),
    );
    if (!mounted) return;
    switch (result) {
      case Success(:final data):
        Navigator.of(context).pop(data);
      case Failure(:final error):
        setState(() {
          _busy = false;
          _error = error;
        });
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final errors = _showErrors ? _form.errors : const <String>[];
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.xl,
            0,
            AppSpacing.xl,
            AppSpacing.xl,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(context.tr('visit.title'), style: text.titleLarge),
              AppSpacing.gapMd,
              if (_error != null) ...[
                FormErrorBanner(message: apiErrorText(context, _error!)),
                AppSpacing.gapMd,
              ],
              RadioGroup<String>(
                groupValue: _form.outcome,
                onChanged: (v) {
                  if (v != null && widget.docs.allows(v)) {
                    setState(() => _form = _form.copyWith(outcome: v));
                  }
                },
                child: Column(
                  children: [
                    for (final o in VisitOutcome.all)
                      RadioListTile<String>(
                        contentPadding: EdgeInsets.zero,
                        value: o,
                        enabled: widget.docs.allows(o),
                        title: Text(context.tr('visit.outcome_$o')),
                        subtitle: widget.docs.allows(o)
                            ? null
                            : Text(context.tr('visit.needs_document_$o')),
                      ),
                  ],
                ),
              ),
              if (_form.outcome == VisitOutcome.noSale) ...[
                AppSpacing.gapSm,
                Text(context.tr('visit.reason'), style: text.titleSmall),
                AppSpacing.gapSm,
                Wrap(
                  spacing: AppSpacing.sm,
                  runSpacing: AppSpacing.sm,
                  children: [
                    for (final r in NoSaleReason.all)
                      ChoiceChip(
                        label: Text(context.tr('visit.reason_$r')),
                        selected: _form.reason == r,
                        onSelected: (_) =>
                            setState(() => _form = _form.copyWith(reason: r)),
                      ),
                  ],
                ),
                if (errors.contains('visit.error_reason'))
                  Padding(
                    padding: const EdgeInsets.only(top: AppSpacing.xs),
                    child: Text(
                      context.tr('visit.error_reason'),
                      style: const TextStyle(color: AppColors.error),
                    ),
                  ),
              ],
              AppSpacing.gapMd,
              TextField(
                maxLength: 255,
                minLines: 1,
                maxLines: 3,
                decoration: InputDecoration(
                  labelText: context.tr(
                    _form.reason == NoSaleReason.other
                        ? 'visit.note_required'
                        : 'order.note',
                  ),
                  errorText: errors.contains('visit.error_note')
                      ? context.tr('visit.error_note')
                      : null,
                ),
                onChanged: (v) =>
                    setState(() => _form = _form.copyWith(note: v)),
              ),
              AppSpacing.gapLg,
              AppButton(
                label: context.tr('visit.save'),
                icon: Icons.flag_outlined,
                loading: _busy,
                onPressed: _save,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
