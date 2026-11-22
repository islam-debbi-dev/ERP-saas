import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../core/design/design.dart';
import '../../../../core/localization/tr.dart';

/// Debounced search box (350 ms) with a clear button.
class SearchInput extends StatefulWidget {
  const SearchInput({
    super.key,
    required this.onChanged,
    this.initialValue = '',
    this.autofocus = false,
    this.hint,
  });

  final ValueChanged<String> onChanged;
  final String initialValue;
  final bool autofocus;
  final String? hint;

  @override
  State<SearchInput> createState() => _SearchInputState();
}

class _SearchInputState extends State<SearchInput> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.initialValue,
  );
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _changed(String value) {
    setState(() {});
    _debounce?.cancel();
    _debounce = Timer(
      const Duration(milliseconds: 350),
      () => widget.onChanged(value.trim()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      autofocus: widget.autofocus,
      textInputAction: TextInputAction.search,
      onChanged: _changed,
      onSubmitted: (v) {
        _debounce?.cancel();
        widget.onChanged(v.trim());
      },
      decoration: InputDecoration(
        hintText: widget.hint ?? context.tr('common.search'),
        prefixIcon: const Icon(Icons.search_rounded),
        suffixIcon: _controller.text.isEmpty
            ? null
            : IconButton(
                tooltip: context.tr('common.clear'),
                icon: const Icon(Icons.close_rounded),
                onPressed: () {
                  _controller.clear();
                  _changed('');
                },
              ),
        filled: true,
        fillColor: context.fieldFill,
        contentPadding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        border: OutlineInputBorder(
          borderRadius: AppRadius.mdAll,
          borderSide: BorderSide(color: context.fieldBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: AppRadius.mdAll,
          borderSide: BorderSide(color: context.fieldBorder),
        ),
      ),
    );
  }
}
