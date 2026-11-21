import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter/foundation.dart';

class AppBlocObserver extends BlocObserver {
  @override
  void onCreate(BlocBase bloc) {
    super.onCreate(bloc);
    if (kDebugMode) {
      final type = _getBlocType(bloc);
      debugPrint('BlocObserver: 🔄 onCreate -- $type: ${bloc.runtimeType}');
    }
  }

  @override
  void onEvent(Bloc bloc, Object? event) {
    super.onEvent(bloc, event);
    if (kDebugMode) {
      debugPrint(
          'BlocObserver: 📤 onEvent -- Bloc: ${bloc.runtimeType}, Event: $event');
    }
  }

  @override
  void onChange(BlocBase bloc, Change change) {
    super.onChange(bloc, change);
    if (kDebugMode) {
      final type = _getBlocType(bloc);
      debugPrint('BlocObserver: 🔄 onChange -- $type: ${bloc.runtimeType}');
      debugPrint('BlocObserver:    Current State: ${change.currentState}');
    }
  }

  @override
  void onTransition(Bloc bloc, Transition transition) {
    super.onTransition(bloc, transition);
    if (kDebugMode) {
      debugPrint('BlocObserver: 🔄 onTransition -- Bloc: ${bloc.runtimeType}');
      debugPrint('BlocObserver:    Event: ${transition.event}');
      debugPrint('BlocObserver:    Previous State: ${transition.currentState}');
      debugPrint('BlocObserver:    Current State: ${transition.nextState}');
    }
  }

  @override
  void onError(BlocBase bloc, Object error, StackTrace stackTrace) {
    if (kDebugMode) {
      final type = _getBlocType(bloc);
      debugPrint('BlocObserver: ❌ onError -- $type: ${bloc.runtimeType}');
      debugPrint('BlocObserver:    Error: $error');
      debugPrint('BlocObserver:    Stack trace: $stackTrace');
    }
    super.onError(bloc, error, stackTrace);
  }

  @override
  void onClose(BlocBase bloc) {
    super.onClose(bloc);
    if (kDebugMode) {
      final type = _getBlocType(bloc);
      debugPrint('BlocObserver: 🔒 onClose -- $type: ${bloc.runtimeType}');
    }
  }

  /// Helper method to determine if the bloc is a Cubit or Bloc
  String _getBlocType(BlocBase bloc) {
    if (bloc is Cubit) {
      return 'Cubit';
    } else if (bloc is Bloc) {
      return 'Bloc';
    }
    return 'BlocBase';
  }
}
