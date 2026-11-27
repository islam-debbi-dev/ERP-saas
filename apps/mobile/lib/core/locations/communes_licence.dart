/// The licence of `assets/data/communes.data.json`. The MIT licence asks for
/// its notice in every copy of the data, so it is a string that ships in the
/// app (a comment would not) and an entry in Flutter's [LicenseRegistry].
/// A test compares it with the header of `packages/shared/src/communes.ts`.
library;

import 'package:flutter/foundation.dart';

/// The name the entry is listed under.
const communesLicencePackage = 'syscli/algeria (communes and dairas data)';

const communesLicenceSource =
    'Source: https://github.com/syscli/algeria\n'
    'Commit: 7789ea926e7c0751f33775ecf558fa026e2ee81b';

const communesLicenceNotice = '''
MIT License

Copyright (c) 2026 syscli

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.''';

/// Call once at startup. The entry is only built if licences are listed.
void registerCommunesLicence() => LicenseRegistry.addLicense(
  () => Stream.value(
    const LicenseEntryWithLineBreaks([
      communesLicencePackage,
    ], '$communesLicenceSource\n\n$communesLicenceNotice'),
  ),
);
