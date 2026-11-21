import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../localization/app_localizations.dart';
import 'format_area.dart';

Widget iconLabel(
  String icon,
  String? label,
  int? count,
  BuildContext context, {
  double? containerSize, // default: 17.w
  double? iconSize, // default: 12.w
  double? spacing, // default: 4.w
  double? fontSize, // default: 12.sp
}) {
  if (label == null) return const SizedBox();
  final localizations = AppLocalizations.of(context);

  final double containerSizeFinal = containerSize ?? 17.w;
  final double iconSizeFinal = iconSize ?? 12.w;
  final double spacingFinal = spacing ?? 4.w;
  final double fontSizeFinal = fontSize ?? 12.sp;

  return Row(
    children: [
      Container(
        width: containerSizeFinal,
        height: containerSizeFinal,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.all(Radius.circular(30.r)),
          color: Theme.of(context).canvasColor,
        ),
        child: SvgPicture.asset(
          'assets/svg/$icon.svg',
          width: iconSizeFinal,
          height: iconSizeFinal,
        ),
      ),
      SizedBox(width: spacingFinal),
      Text(
        label == 'sqm'
            ? formatArea(context, count ?? 0)
            : "${label == 'floor' && (count == null || count == 0) ? 'R' : (count != null && count > 0 ? count.toString() : '')} ${localizations!.translate(label)}",
        textDirection: Directionality.of(context),
        style: TextStyle(
          fontSize: fontSizeFinal,
          fontWeight: FontWeight.w400,
          fontFamily: 'Almarai',
          color: const Color.fromRGBO(130, 130, 130, 1),
        ),
      ),
    ],
  );
}
