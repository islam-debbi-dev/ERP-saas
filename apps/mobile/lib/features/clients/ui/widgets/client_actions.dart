import 'package:flutter/material.dart';

import '../../data/models/client.dart';

/// The field actions on a client (sale, order, versement, visit), each shown
/// only with the user's right. [clientPath] is the client's own path; the
/// action screens are pushed under it so they keep the role's prefix.
List<Widget> clientActions(
  BuildContext context,
  Client client,
  String clientPath,
) => const [];
