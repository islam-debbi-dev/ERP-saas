import 'package:orvynt_starter/core/network/token_storage.dart';

class MemoryTokenStore implements TokenStore {
  MemoryTokenStore({this.access = '', this.refresh = ''});

  String access;
  String refresh;
  int clears = 0;

  @override
  Future<String> readAccessToken() async => access;

  @override
  Future<String> readRefreshToken() async => refresh;

  @override
  Future<void> save({
    required String accessToken,
    required String refreshToken,
  }) async {
    access = accessToken;
    refresh = refreshToken;
  }

  @override
  Future<void> clear() async {
    clears++;
    access = '';
    refresh = '';
  }
}
