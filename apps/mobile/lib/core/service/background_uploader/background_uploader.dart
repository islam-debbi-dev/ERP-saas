// import 'dart:io';
// import 'package:background_downloader/background_downloader.dart' as bd;

// import '../../helpers/shared_pref_helper.dart';
// import '../../helpers/constants.dart';

// class BackgroundUploader {
//   static final BackgroundUploader _instance = BackgroundUploader._internal();
//   factory BackgroundUploader() => _instance;
//   BackgroundUploader._internal();

//   Future<String> uploadProperty({
//     required String url,
//     required Map<String, String> fields,
//     required List<String> imagePaths,
//     String? metaData,
//   }) async {
//     // check files exist
//     for (final path in imagePaths) {
//       if (!await File(path).exists()) {
//         throw Exception('File not found: $path');
//       }
//     }
//     final files = <(String, String)>[
//       for (final path in imagePaths) ('images[]', path),
//     ];
//     // headers
//     final headers = <String, String>{'Accept': 'application/json'};
//     final token =
//         await SharedPrefHelper.getSecuredString(SharedPrefKeys.userToken);
//     if (token.isNotEmpty) {
//       headers['Authorization'] = 'Bearer $token';
//     }

//     // Build MultiUploadTask
//     final task = bd.MultiUploadTask(
//       url: url,
//       files: files,
//       fields: fields,
//       headers: headers,
//       httpRequestMethod: 'POST',
//       updates: bd.Updates.statusAndProgress,
//       retries: 3,
//       metaData: metaData ?? '',
//     );

//     // enqueue
//     final taskId = await bd.FileDownloader().enqueue(task);

//     return taskId.toString();
//   }
// }
