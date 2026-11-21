import 'dart:convert';
import 'package:flutter/material.dart';

import 'shared_pref_helper.dart';

class CacheHelper {
  static const int _defaultCacheDurationMs = 30 * 60 * 1000; // 30 minutes

  /// Save data to cache with timestamp
  static Future<void> saveToCache(
    String key,
    dynamic data, {
    int? cacheDurationMs,
  }) async {
    try {
      final dataJson = jsonEncode(data);
      final timestamp = DateTime.now().millisecondsSinceEpoch.toString();
      final timestampKey = '${key}_timestamp';

      await SharedPrefHelper.writeData(key, dataJson);
      await SharedPrefHelper.writeData(timestampKey, timestamp);
    } catch (e) {
      debugPrint("Error saving to cache: $e");
    }
  }

  /// Load data from cache if not expired
  static Future<dynamic> loadFromCache(
    String key, {
    int? cacheDurationMs,
  }) async {
    try {
      final dataJson = await SharedPrefHelper.readData(key);
      final timestampJson = await SharedPrefHelper.readData('${key}_timestamp');

      if (dataJson != null && timestampJson != null) {
        final timestamp = int.tryParse(timestampJson) ?? 0;
        final currentTime = DateTime.now().millisecondsSinceEpoch;
        final duration = cacheDurationMs ?? _defaultCacheDurationMs;

        // Check if cache is still valid
        if (currentTime - timestamp < duration) {
          return jsonDecode(dataJson);
        }
      }
      return null;
    } catch (e) {
      debugPrint("Error loading from cache: $e");
      return null;
    }
  }

  /// Clear specific cache entry
  static Future<void> clearCache(String key) async {
    try {
      await SharedPrefHelper.removeData(key);
      await SharedPrefHelper.removeData('${key}_timestamp');
    } catch (e) {
      debugPrint("Error clearing cache: $e");
    }
  }

  /// Check if cache is valid for a given key
  static Future<bool> isCacheValid(String key, {int? cacheDurationMs}) async {
    try {
      final timestampJson = await SharedPrefHelper.readData('${key}_timestamp');
      if (timestampJson != null) {
        final timestamp = int.tryParse(timestampJson) ?? 0;
        final currentTime = DateTime.now().millisecondsSinceEpoch;
        final duration = cacheDurationMs ?? _defaultCacheDurationMs;

        return currentTime - timestamp < duration;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  /// Get cache age in milliseconds
  static Future<int> getCacheAge(String key) async {
    try {
      final timestampJson = await SharedPrefHelper.readData('${key}_timestamp');
      if (timestampJson != null) {
        final timestamp = int.tryParse(timestampJson) ?? 0;
        final currentTime = DateTime.now().millisecondsSinceEpoch;
        return currentTime - timestamp;
      }
      return -1; // Cache doesn't exist
    } catch (e) {
      return -1;
    }
  }
}
