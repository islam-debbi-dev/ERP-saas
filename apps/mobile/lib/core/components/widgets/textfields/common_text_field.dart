import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../design/app_spacing.dart';
import '../../../theme/app_theme.dart';

class CommonTextField extends StatefulWidget {
  final TextEditingController controller;
  final String hint;
  final String?
  svgAsset; // optional SVG path (shown when not using isSearch initia  l icon)
  final IconData? icon; // optional IconData
  final bool obscureText;
  final TextInputType keyboardType;

  /// Show a clear (x) button when text not empty
  final bool showClearButton;

  /// If true — this field acts like a search field that starts as a 40x40 icon button
  /// and expands to the text field when tapped, then collapses back when unfocused & empty.
  final bool isSearch;

  /// Size (width/height) of the collapsed search icon button when `isSearch == true`.
  /// Defaults to 40.
  final double searchIconSize;

  /// If true, the collapsed search state will show a plain icon (no boxed button).
  /// Default is false (boxed button).
  final bool searchCollapsedAsIcon;

  /// Text size (font size for the text field)
  final double textSize;

  /// Allow multiple lines for long text
  final bool allowLongText;

  /// Maximum lines for long text (null = unlimited)
  final int? maxLines;

  /// Validation callback - returns error message or null if valid
  final String? Function(String)? onValidate;

  /// Error message to display
  final String? errorMessage;

  /// Optional trailing action icon (e.g. filter). Provide either `actionIcon` or `actionSvg`.
  final IconData? actionIcon;
  final String? actionSvg;

  /// Callback when action icon is tapped
  final VoidCallback? onActionTap;

  /// Size for the action icon
  final double actionIconSize;

  /// If true and `isSearch == true`, show the action button even in the collapsed state
  final bool showActionInCollapsed;

  /// Border color when the field is focused
  final Color? focusedBorderColor;

  /// Border color when the field is not focused
  final Color unfocusedBorderColor;

  /// Icon color when focused
  final Color focusedIconColor;

  /// Icon color when not focused
  final Color unfocusedIconColor;

  /// Shadow color to use when focused (optional). If null a default from theme is used.
  final Color? focusedShadowColor;

  /// Color for the action icon (trailing)
  final Color actionIconColor;

  const CommonTextField({
    super.key,
    required this.controller,
    required this.hint,
    this.svgAsset,
    this.icon,
    this.obscureText = false,
    this.keyboardType = TextInputType.text,
    this.showClearButton = false,
    this.isSearch = false,
    this.searchIconSize = 40,
    this.searchCollapsedAsIcon = false,
    this.textSize = 16,
    this.allowLongText = false,
    this.maxLines,
    this.onValidate,
    this.errorMessage,
    this.actionIcon,
    this.actionSvg,
    this.onActionTap,
    this.actionIconSize = 20,
    this.showActionInCollapsed = false,
    this.focusedBorderColor,
    this.unfocusedBorderColor = AppColors.divider,
    this.focusedIconColor = AppColors.threedColor,
    this.unfocusedIconColor = AppColors.textTertiary,
    this.focusedShadowColor,
    this.actionIconColor = AppColors.textSecondary,
  });

  @override
  State<CommonTextField> createState() => _CommonTextFieldState();
}

class _CommonTextFieldState extends State<CommonTextField>
    with SingleTickerProviderStateMixin {
  final FocusNode _focusNode = FocusNode();
  bool _isFocused = false;

  /// When `isSearch == true` this controls whether the text field is currently visible (expanded)
  bool _showTextField = false;

  /// Toggle visibility for password fields
  bool _isPasswordVisible = false;

  /// Validation error message
  String? _validationError;

  late final AnimationController _animController;
  late final Animation<double> _scaleAnim;

  @override
  void initState() {
    super.initState();

    // If isSearch is false, the text field should be visible by default.
    _showTextField = !widget.isSearch;

    _focusNode.addListener(_handleFocusChange);

    // We need controller listener to show/hide clear button and possibly collapse if text is cleared.
    widget.controller.addListener(_handleTextChange);

    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 250),
    );

    _scaleAnim = Tween<double>(begin: 1.0, end: 1.02).animate(
      CurvedAnimation(parent: _animController, curve: Curves.easeInOut),
    );
  }

  void _handleFocusChange() {
    final focused = _focusNode.hasFocus;
    setState(() => _isFocused = focused);

    // If we lost focus, and it's a search field, collapse back to icon
    if (!_isFocused && widget.isSearch) {
      setState(() => _showTextField = false);
      _animController.reverse();
    }
  }

  void _handleTextChange() {
    // Validate if callback provided
    if (widget.onValidate != null) {
      setState(() {
        _validationError = widget.onValidate!(widget.controller.text);
      });
    } else {
      setState(() {});
    }
  }

  @override
  void dispose() {
    _focusNode.removeListener(_handleFocusChange);
    _focusNode.dispose();
    widget.controller.removeListener(_handleTextChange);
    _animController.dispose();
    super.dispose();
  }

  void _onInitialIconTap() {
    // expand to show text field and focus it
    setState(() {
      _showTextField = true;
    });
    _animController.forward();
    // wait a microtask to request focus after rebuild
    Future.microtask(() => _focusNode.requestFocus());
  }

  @override
  Widget build(BuildContext context) {
    final hasError = widget.errorMessage != null || _validationError != null;
    final displayError = widget.errorMessage ?? _validationError;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    // container decoration used for both states - theme aware
    BoxDecoration decoration = BoxDecoration(
      color: isDark ? AppColors.darkSurface : AppColors.surface,
      borderRadius: AppRadius.mdAll,
      border: Border.all(
        color: hasError
            ? AppColors.error
            : _isFocused
            ? (widget.focusedBorderColor ??
                  (isDark ? AppColors.yellow : AppColors.ink))
            : (isDark ? AppColors.darkDivider : widget.unfocusedBorderColor),
        width: 1.5,
      ),
      boxShadow: _isFocused
          ? [
              BoxShadow(
                color: (widget.focusedShadowColor ?? AppColors.ink)
                    .withValues(alpha: 0.08),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ]
          : [],
    );

    Widget textFieldWidget;

    // When acting as search with initial icon, animate between collapsed icon button and full width
    if (widget.isSearch) {
      textFieldWidget = AnimatedSize(
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeInOut,
        child: _showTextField
            // expanded: try to take available width from parent; if parent gives
            // unbounded width (e.g. inside a Row without Expanded), fall back to
            // MediaQuery screen width to avoid double.infinity.
            ? LayoutBuilder(
                builder: (context, constraints) {
                  // If parent gives a finite maxWidth use it. If it's unbounded
                  // (common when placed directly inside a Row), avoid using the
                  // full screen width because siblings (other Row children)
                  // also take space and cause overflow. Use a conservative
                  // fallback of screen width minus a safe margin.
                  final double maxWidth = constraints.maxWidth.isFinite
                      ? constraints.maxWidth
                      : (MediaQuery.of(context).size.width - 80).clamp(
                          80.0,
                          MediaQuery.of(context).size.width,
                        );
                  return SizedBox(
                    width: maxWidth,
                    child: _buildExpandedField(decoration),
                  );
                },
              )
            // collapsed: only the small icon button (keeps its intrinsic size)
            : Align(
                alignment: AlignmentDirectional.centerStart,
                child: _buildIconButton(),
              ),
      );
    } else {
      // Normal (non-search) behavior — always show the text field
      textFieldWidget = ScaleTransition(
        scale: _scaleAnim,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeInOut,
          constraints: BoxConstraints(
            minHeight: 0,
            maxHeight: double.infinity,
            minWidth: 0,
            maxWidth: double.infinity,
          ),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
          decoration: decoration,
          child: _buildRowContent(showLeadingAsButton: false),
        ),
      );
    }

    // Wrap with Column to show error message
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        textFieldWidget,
        if (displayError != null)
          Padding(
            padding: const EdgeInsetsDirectional.only(top: 6.0, start: 8.0),
            child: Text(
              displayError,
              style: TextStyle(
                fontFamily: 'Almarai',
                fontSize: 12,
                color: AppColors.error,
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildActionButton() {
    // action button used in expanded or collapsed (if enabled)
    // Use compact GestureDetector instead of IconButton to avoid padding that increases height
    if (widget.actionSvg != null) {
      return GestureDetector(
        onTap: widget.onActionTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4.0),
          child: SvgPicture.asset(
            widget.actionSvg!,
            height: widget.actionIconSize,
            width: widget.actionIconSize,
            colorFilter: ColorFilter.mode(
              widget.actionIconColor,
              BlendMode.srcIn,
            ),
          ),
        ),
      );
    }

    if (widget.actionIcon != null) {
      return GestureDetector(
        onTap: widget.onActionTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4.0),
          child: Icon(
            widget.actionIcon,
            size: widget.actionIconSize,
            color: widget.actionIconColor,
          ),
        ),
      );
    }

    return const SizedBox.shrink();
  }

  Widget _buildIconButton() {
    // collapsed icon button (size configurable when used as search)
    final double btnSize = widget.isSearch ? widget.searchIconSize : 40;
    final double iconSize = (btnSize * 0.5).clamp(12.0, 28.0);

    Widget iconChild;
    if (widget.svgAsset != null) {
      iconChild = SvgPicture.asset(
        widget.svgAsset!,
        height: iconSize,
        width: iconSize,
        colorFilter: ColorFilter.mode(
          _isFocused ? widget.focusedIconColor : widget.unfocusedIconColor,
          BlendMode.srcIn,
        ),
      );
    } else if (widget.icon != null) {
      iconChild = Icon(
        widget.icon,
        size: iconSize,
        color: _isFocused ? widget.focusedIconColor : widget.unfocusedIconColor,
      );
    } else {
      // default search icon when none provided
      iconChild = Icon(
        Icons.search,
        size: iconSize,
        color: _isFocused ? widget.focusedIconColor : widget.unfocusedIconColor,
      );
    }

    // collapsed as plain icon (no boxed container)
    final Widget iconOnly = GestureDetector(
      onTap: _onInitialIconTap,
      child: SizedBox(
        width: btnSize,
        height: btnSize,
        child: Center(child: iconChild),
      ),
    );

    // boxed container (original behavior)
    final Widget boxed = Container(
      height: btnSize,
      width: btnSize,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadius.mdAll,
        border: Border.all(color: widget.unfocusedBorderColor, width: 1.2),
        boxShadow: [],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: AppRadius.mdAll,
          onTap: _onInitialIconTap,
          child: Center(child: iconChild),
        ),
      ),
    );

    final Widget iconContainer = widget.searchCollapsedAsIcon
        ? iconOnly
        : boxed;

    if (widget.showActionInCollapsed &&
        (widget.actionIcon != null || widget.actionSvg != null)) {
      return _buildCollapsedWithAction(btnSize, iconContainer);
    }

    return iconContainer;
  }

  // If collapsed search should show an action button, return a small row with the
  // collapsed icon and the action button beside it.
  Widget _buildCollapsedWithAction(double btnSize, Widget iconContainer) {
    // small spacing between icon and action
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        iconContainer,
        if ((widget.actionIcon != null || widget.actionSvg != null) &&
            widget.showActionInCollapsed)
          Padding(
            padding: const EdgeInsetsDirectional.only(start: 8.0),
            child: _buildActionButton(),
          ),
      ],
    );
  }

  Widget _buildExpandedField(BoxDecoration decoration) {
    return ScaleTransition(
      scale: _scaleAnim,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeInOut,
        constraints: BoxConstraints(
          minHeight: 0,
          maxHeight: double.infinity,
          minWidth: 0,
          maxWidth: double.infinity,
        ),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: decoration,
        // full width row content (leading icon/svg, text field, clear)
        child: _buildRowContent(showLeadingAsButton: true),
      ),
    );
  }

  Widget _buildRowContent({required bool showLeadingAsButton}) {
    return Row(
      children: [
        // Leading: if isSearch and we expanded, show the icon (not as a button)
        if (widget.isSearch)
          Padding(
            padding: const EdgeInsetsDirectional.only(end: 8.0),
            child: widget.svgAsset != null
                ? SvgPicture.asset(
                    widget.svgAsset!,
                    height: 20,
                    width: 20,
                    colorFilter: ColorFilter.mode(
                      _isFocused
                          ? widget.focusedIconColor
                          : widget.unfocusedIconColor,
                      BlendMode.srcIn,
                    ),
                  )
                : Icon(
                    widget.icon ?? Icons.search,
                    size: 20,
                    color: _isFocused
                        ? widget.focusedIconColor
                        : widget.unfocusedIconColor,
                  ),
          )
        else
        // non-search: optionally show svg or icon if provided
        if (widget.svgAsset != null)
          Padding(
            padding: const EdgeInsetsDirectional.only(end: 8.0),
            child: SvgPicture.asset(
              widget.svgAsset!,
              height: 20,
              width: 20,
              colorFilter: ColorFilter.mode(
                _isFocused
                    ? widget.focusedIconColor
                    : widget.unfocusedIconColor,
                BlendMode.srcIn,
              ),
            ),
          )
        else if (widget.icon != null)
          Padding(
            padding: const EdgeInsetsDirectional.only(end: 8.0),
            child: Icon(
              widget.icon,
              size: 20,
              color: _isFocused
                  ? widget.focusedIconColor
                  : widget.unfocusedIconColor,
            ),
          ),

        // Text field
        Expanded(
          child: TextField(
            controller: widget.controller,
            focusNode: _focusNode,
            obscureText: widget.obscureText ? !_isPasswordVisible : false,
            keyboardType: widget.keyboardType,
            maxLines: widget.allowLongText ? (widget.maxLines ?? 5) : 1,
            minLines: widget.allowLongText ? 1 : null,
            style: TextStyle(
              fontFamily: 'Almarai',
              fontSize: widget.textSize,
              color:
                  Theme.of(context).textTheme.bodyLarge?.color ??
                  Colors.black87,
            ),
            decoration: InputDecoration(
              hintText: widget.hint,
              hintStyle: TextStyle(
                fontFamily: 'Almarai',
                fontSize: widget.textSize - 1,
                color: Theme.of(context).brightness == Brightness.dark
                    ? Colors.grey.shade500
                    : Colors.grey.shade500,
              ),
              border: InputBorder.none,
              isDense: true,
            ),
            onEditingComplete: () {
              // Collapse when done editing if it's a search field
              if (widget.isSearch) {
                _focusNode.unfocus();
              } else {
                _focusNode.unfocus();
              }
            },
          ),
        ),

        // Visibility toggle button (only for password fields) — compact, no padding
        if (widget.obscureText)
          GestureDetector(
            onTap: () {
              setState(() => _isPasswordVisible = !_isPasswordVisible);
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4.0),
              child: Icon(
                _isPasswordVisible ? Icons.visibility : Icons.visibility_off,
                size: 18.sp,
                color: widget.unfocusedIconColor,
              ),
            ),
          ),

        // Clear button (optional) — compact, no padding
        if (widget.showClearButton && widget.controller.text.isNotEmpty)
          GestureDetector(
            onTap: () {
              widget.controller.clear();
              // if it's search style and unfocused, collapse back
              if (widget.isSearch && !_focusNode.hasFocus) {
                setState(() => _showTextField = false);
                _animController.reverse();
              } else {
                setState(() {}); // update UI immediately
              }
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4.0),
              child: Icon(
                Icons.close_rounded,
                size: 18.sp,
                color: widget.unfocusedIconColor,
              ),
            ),
          ),
        // Action button (optional)
        if ((widget.actionIcon != null || widget.actionSvg != null) &&
            widget.onActionTap != null)
          _buildActionButton(),
      ],
    );
  }
}
