import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/connectivity_services.dart';
import '../../../core/localization/tr.dart';
import '../../../core/router/role_screens.dart';
import '../../../core/session/session_cubit.dart';
import 'widgets/custom_bottom_navigation.dart';
import 'widgets/no_connection_banner.dart';

/// Shell of the role's tabs: keeps each tab's state alive, shows the
/// floating bottom bar and the offline banner.
class MainScreen extends StatefulWidget {
  const MainScreen({
    super.key,
    required this.role,
    required this.navigationShell,
  });

  /// The role whose shell this is (branches = `RoleScreens.allTabsFor(role)`).
  final String role;
  final StatefulNavigationShell navigationShell;

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  late final ConnectivityService _connectivity = getIt<ConnectivityService>();

  @override
  void initState() {
    super.initState();
    _connectivity.init(
      onReconnect: () {
        if (mounted) setState(() {});
      },
    );
  }

  void _onTab(int branch) {
    widget.navigationShell.goBranch(
      branch,
      // Re-tapping the current tab returns it to its root.
      initialLocation: branch == widget.navigationShell.currentIndex,
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = context.watch<SessionCubit>().state.user;
    final all = RoleScreens.allTabsFor(widget.role);
    final visible = user == null
        ? const <RoleTab>[]
        : RoleScreens.visibleTabsFor(user);
    // Bottom-bar position ↔ shell branch (hidden tabs keep their branch).
    final branches = [for (final t in visible) all.indexOf(t)];
    final current = branches.indexOf(widget.navigationShell.currentIndex);

    return PopScope(
      // Back on a secondary tab returns to the first tab before leaving.
      canPop: current <= 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && branches.isNotEmpty) _onTab(branches.first);
      },
      child: Scaffold(
        extendBody: true,
        resizeToAvoidBottomInset: false,
        body: Stack(
          children: [
            widget.navigationShell,
            ValueListenableBuilder<bool>(
              valueListenable: _connectivity.isOffline,
              builder: (_, isOffline, _) => isOffline
                  ? const Positioned(
                      top: 0,
                      left: 0,
                      right: 0,
                      child: NoConnectionBanner(),
                    )
                  : const SizedBox.shrink(),
            ),
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              child: visible.length < 2
                  ? const SizedBox.shrink()
                  : CustomBottomNavigation(
                      items: [
                        for (final t in visible)
                          NavItem(icon: t.icon, label: context.tr(t.labelKey)),
                      ],
                      currentIndex: current < 0 ? 0 : current,
                      onItemTapped: (i) => _onTab(branches[i]),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
