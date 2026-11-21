import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orvynt_starter/core/config/app_env.dart';

void main() {
  test('empty env falls back to production API, Debvora, no dashboard', () {
    dotenv.testLoad(fileInput: '');
    expect(AppEnv.apiBaseUrl, AppEnv.productionApiUrl);
    expect(AppEnv.appName, 'Debvora');
    expect(AppEnv.dashboardUrl, '');
    expect(AppEnv.supportEmail, '');
  });

  test('env file values win and lose their trailing slash', () {
    dotenv.testLoad(
      fileInput:
          'API_BASE_URL=http://10.0.2.2:3001/\nDASHBOARD_URL=http://10.0.2.2:3000/\nAPP_NAME=Test',
    );
    expect(AppEnv.apiBaseUrl, 'http://10.0.2.2:3001');
    expect(AppEnv.dashboardUrl, 'http://10.0.2.2:3000');
    expect(AppEnv.appName, 'Test');
  });

  test('brand colours come from the env', () {
    dotenv.testLoad(
      fileInput: 'APP_PRIMARY_COLOR="#1B7F5E"\nAPP_SECONDARY_COLOR=80112233',
    );
    expect(AppEnv.primaryColor, const Color(0xFF1B7F5E));
    expect(AppEnv.secondaryColor, const Color(0x80112233));
  });

  test('a malformed colour fails loudly in debug builds', () {
    expect(
      () => AppEnv.parseHexColor('APP_PRIMARY_COLOR', 'yellow', Colors.red),
      throwsStateError,
    );
  });
}
