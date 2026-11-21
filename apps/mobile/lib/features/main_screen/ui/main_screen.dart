import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/di/dependency_injection.dart';
import '../../../core/helpers/connectivity_services.dart';
import 'widgets/custom_bottom_navigation.dart';
import 'widgets/no_connection_banner.dart';

/// Shell of the role's tabs: keeps each tab's state alive, shows the
/// floating bottom bar and the offline banner.
class MainScreen extends StatefulWidget {
  const MainScreen({super.key, required this.navigationShell});

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

  void _onTab(int index) {
    widget.navigationShell.goBranch(
      index,
      // Re-tapping the current tab returns it to its root.
      initialLocation: index == widget.navigationShell.currentIndex,
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      // Back on a secondary tab returns to Home before leaving the app.
      canPop: widget.navigationShell.currentIndex == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) widget.navigationShell.goBranch(0);
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
              child: widget.navigationShell.route.branches.length < 2
                  ? const SizedBox.shrink()
                  : CustomBottomNavigation(
                      currentIndex: widget.navigationShell.currentIndex,
                      onItemTapped: _onTab,
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
