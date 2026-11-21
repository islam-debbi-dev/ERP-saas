// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'cart_state.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$CartState {

 List<CartLine> get lines; bool get orderingEnabled; num get deliveryFeeSetting; num get minOrderAmount;/// Every-Nth-order free delivery progress (signed-in clients).
 LoyaltyStatus? get loyalty;/// Server message per line key after an order was refused because of a
/// size / option (`PRODUCT_OPTION_*`), shown on that cart line.
 Map<String, String> get lineErrors;
/// Create a copy of CartState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CartStateCopyWith<CartState> get copyWith => _$CartStateCopyWithImpl<CartState>(this as CartState, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CartState&&const DeepCollectionEquality().equals(other.lines, lines)&&(identical(other.orderingEnabled, orderingEnabled) || other.orderingEnabled == orderingEnabled)&&(identical(other.deliveryFeeSetting, deliveryFeeSetting) || other.deliveryFeeSetting == deliveryFeeSetting)&&(identical(other.minOrderAmount, minOrderAmount) || other.minOrderAmount == minOrderAmount)&&(identical(other.loyalty, loyalty) || other.loyalty == loyalty)&&const DeepCollectionEquality().equals(other.lineErrors, lineErrors));
}


@override
int get hashCode => Object.hash(runtimeType,const DeepCollectionEquality().hash(lines),orderingEnabled,deliveryFeeSetting,minOrderAmount,loyalty,const DeepCollectionEquality().hash(lineErrors));

@override
String toString() {
  return 'CartState(lines: $lines, orderingEnabled: $orderingEnabled, deliveryFeeSetting: $deliveryFeeSetting, minOrderAmount: $minOrderAmount, loyalty: $loyalty, lineErrors: $lineErrors)';
}


}

/// @nodoc
abstract mixin class $CartStateCopyWith<$Res>  {
  factory $CartStateCopyWith(CartState value, $Res Function(CartState) _then) = _$CartStateCopyWithImpl;
@useResult
$Res call({
 List<CartLine> lines, bool orderingEnabled, num deliveryFeeSetting, num minOrderAmount, LoyaltyStatus? loyalty, Map<String, String> lineErrors
});




}
/// @nodoc
class _$CartStateCopyWithImpl<$Res>
    implements $CartStateCopyWith<$Res> {
  _$CartStateCopyWithImpl(this._self, this._then);

  final CartState _self;
  final $Res Function(CartState) _then;

/// Create a copy of CartState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? lines = null,Object? orderingEnabled = null,Object? deliveryFeeSetting = null,Object? minOrderAmount = null,Object? loyalty = freezed,Object? lineErrors = null,}) {
  return _then(_self.copyWith(
lines: null == lines ? _self.lines : lines // ignore: cast_nullable_to_non_nullable
as List<CartLine>,orderingEnabled: null == orderingEnabled ? _self.orderingEnabled : orderingEnabled // ignore: cast_nullable_to_non_nullable
as bool,deliveryFeeSetting: null == deliveryFeeSetting ? _self.deliveryFeeSetting : deliveryFeeSetting // ignore: cast_nullable_to_non_nullable
as num,minOrderAmount: null == minOrderAmount ? _self.minOrderAmount : minOrderAmount // ignore: cast_nullable_to_non_nullable
as num,loyalty: freezed == loyalty ? _self.loyalty : loyalty // ignore: cast_nullable_to_non_nullable
as LoyaltyStatus?,lineErrors: null == lineErrors ? _self.lineErrors : lineErrors // ignore: cast_nullable_to_non_nullable
as Map<String, String>,
  ));
}

}


/// Adds pattern-matching-related methods to [CartState].
extension CartStatePatterns on CartState {
/// A variant of `map` that fallback to returning `orElse`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CartState value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CartState() when $default != null:
return $default(_that);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// Callbacks receives the raw object, upcasted.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case final Subclass2 value:
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CartState value)  $default,){
final _that = this;
switch (_that) {
case _CartState():
return $default(_that);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `map` that fallback to returning `null`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CartState value)?  $default,){
final _that = this;
switch (_that) {
case _CartState() when $default != null:
return $default(_that);case _:
  return null;

}
}
/// A variant of `when` that fallback to an `orElse` callback.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( List<CartLine> lines,  bool orderingEnabled,  num deliveryFeeSetting,  num minOrderAmount,  LoyaltyStatus? loyalty,  Map<String, String> lineErrors)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CartState() when $default != null:
return $default(_that.lines,_that.orderingEnabled,_that.deliveryFeeSetting,_that.minOrderAmount,_that.loyalty,_that.lineErrors);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// As opposed to `map`, this offers destructuring.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case Subclass2(:final field2):
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( List<CartLine> lines,  bool orderingEnabled,  num deliveryFeeSetting,  num minOrderAmount,  LoyaltyStatus? loyalty,  Map<String, String> lineErrors)  $default,) {final _that = this;
switch (_that) {
case _CartState():
return $default(_that.lines,_that.orderingEnabled,_that.deliveryFeeSetting,_that.minOrderAmount,_that.loyalty,_that.lineErrors);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `when` that fallback to returning `null`
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( List<CartLine> lines,  bool orderingEnabled,  num deliveryFeeSetting,  num minOrderAmount,  LoyaltyStatus? loyalty,  Map<String, String> lineErrors)?  $default,) {final _that = this;
switch (_that) {
case _CartState() when $default != null:
return $default(_that.lines,_that.orderingEnabled,_that.deliveryFeeSetting,_that.minOrderAmount,_that.loyalty,_that.lineErrors);case _:
  return null;

}
}

}

/// @nodoc


class _CartState extends CartState {
  const _CartState({final  List<CartLine> lines = const <CartLine>[], this.orderingEnabled = true, this.deliveryFeeSetting = 0, this.minOrderAmount = 0, this.loyalty, final  Map<String, String> lineErrors = const <String, String>{}}): _lines = lines,_lineErrors = lineErrors,super._();
  

 final  List<CartLine> _lines;
@override@JsonKey() List<CartLine> get lines {
  if (_lines is EqualUnmodifiableListView) return _lines;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_lines);
}

@override@JsonKey() final  bool orderingEnabled;
@override@JsonKey() final  num deliveryFeeSetting;
@override@JsonKey() final  num minOrderAmount;
/// Every-Nth-order free delivery progress (signed-in clients).
@override final  LoyaltyStatus? loyalty;
/// Server message per line key after an order was refused because of a
/// size / option (`PRODUCT_OPTION_*`), shown on that cart line.
 final  Map<String, String> _lineErrors;
/// Server message per line key after an order was refused because of a
/// size / option (`PRODUCT_OPTION_*`), shown on that cart line.
@override@JsonKey() Map<String, String> get lineErrors {
  if (_lineErrors is EqualUnmodifiableMapView) return _lineErrors;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableMapView(_lineErrors);
}


/// Create a copy of CartState
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CartStateCopyWith<_CartState> get copyWith => __$CartStateCopyWithImpl<_CartState>(this, _$identity);



@override
bool operator ==(Object other) {
  return identical(this, other) || (other.runtimeType == runtimeType&&other is _CartState&&const DeepCollectionEquality().equals(other._lines, _lines)&&(identical(other.orderingEnabled, orderingEnabled) || other.orderingEnabled == orderingEnabled)&&(identical(other.deliveryFeeSetting, deliveryFeeSetting) || other.deliveryFeeSetting == deliveryFeeSetting)&&(identical(other.minOrderAmount, minOrderAmount) || other.minOrderAmount == minOrderAmount)&&(identical(other.loyalty, loyalty) || other.loyalty == loyalty)&&const DeepCollectionEquality().equals(other._lineErrors, _lineErrors));
}


@override
int get hashCode => Object.hash(runtimeType,const DeepCollectionEquality().hash(_lines),orderingEnabled,deliveryFeeSetting,minOrderAmount,loyalty,const DeepCollectionEquality().hash(_lineErrors));

@override
String toString() {
  return 'CartState(lines: $lines, orderingEnabled: $orderingEnabled, deliveryFeeSetting: $deliveryFeeSetting, minOrderAmount: $minOrderAmount, loyalty: $loyalty, lineErrors: $lineErrors)';
}


}

/// @nodoc
abstract mixin class _$CartStateCopyWith<$Res> implements $CartStateCopyWith<$Res> {
  factory _$CartStateCopyWith(_CartState value, $Res Function(_CartState) _then) = __$CartStateCopyWithImpl;
@override @useResult
$Res call({
 List<CartLine> lines, bool orderingEnabled, num deliveryFeeSetting, num minOrderAmount, LoyaltyStatus? loyalty, Map<String, String> lineErrors
});




}
/// @nodoc
class __$CartStateCopyWithImpl<$Res>
    implements _$CartStateCopyWith<$Res> {
  __$CartStateCopyWithImpl(this._self, this._then);

  final _CartState _self;
  final $Res Function(_CartState) _then;

/// Create a copy of CartState
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? lines = null,Object? orderingEnabled = null,Object? deliveryFeeSetting = null,Object? minOrderAmount = null,Object? loyalty = freezed,Object? lineErrors = null,}) {
  return _then(_CartState(
lines: null == lines ? _self._lines : lines // ignore: cast_nullable_to_non_nullable
as List<CartLine>,orderingEnabled: null == orderingEnabled ? _self.orderingEnabled : orderingEnabled // ignore: cast_nullable_to_non_nullable
as bool,deliveryFeeSetting: null == deliveryFeeSetting ? _self.deliveryFeeSetting : deliveryFeeSetting // ignore: cast_nullable_to_non_nullable
as num,minOrderAmount: null == minOrderAmount ? _self.minOrderAmount : minOrderAmount // ignore: cast_nullable_to_non_nullable
as num,loyalty: freezed == loyalty ? _self.loyalty : loyalty // ignore: cast_nullable_to_non_nullable
as LoyaltyStatus?,lineErrors: null == lineErrors ? _self._lineErrors : lineErrors // ignore: cast_nullable_to_non_nullable
as Map<String, String>,
  ));
}


}

// dart format on
