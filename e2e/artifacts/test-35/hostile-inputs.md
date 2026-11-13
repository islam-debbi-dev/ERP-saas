# Hostile input on /clients/map and /clients/nearby

85 requests as tenant A's owner.

| Input | Why | Expected | HTTP | code |
|---|---|---|---|---|
| `/clients/map?minLat=36` | incomplete box (minLat) | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLng=2` | incomplete box (minLng) | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=36&minLng=2` | incomplete box (minLat, minLng) | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?maxLat=37` | incomplete box (maxLat) | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=36&maxLat=37` | incomplete box (minLat, maxLat) | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLng=2&maxLat=37` | incomplete box (minLng, maxLat) | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=36&minLng=2&maxLat=37` | incomplete box (minLat, minLng, maxLat) | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?maxLng=4` | incomplete box (maxLng) | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=36&maxLng=4` | incomplete box (minLat, maxLng) | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLng=2&maxLng=4` | incomplete box (minLng, maxLng) | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=36&minLng=2&maxLng=4` | incomplete box (minLat, minLng, maxLng) | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?maxLat=37&maxLng=4` | incomplete box (maxLat, maxLng) | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=36&maxLat=37&maxLng=4` | incomplete box (minLat, maxLat, maxLng) | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLng=2&maxLat=37&maxLng=4` | incomplete box (minLng, maxLat, maxLng) | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=37&minLng=2&maxLat=36&maxLng=4` | minLat > maxLat | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=36&minLng=2&maxLat=36&maxLng=4` | minLat = maxLat | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=36&minLng=4&maxLat=37&maxLng=2` | minLng > maxLng | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=36&minLng=179&maxLat=37&maxLng=-179` | box across the antimeridian (minLng 179, maxLng -179) | no-500 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=36&minLng=2&maxLat=90.0001&maxLng=4` | maxLat above 90 | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=-91&minLng=2&maxLat=37&maxLng=4` | minLat below -90 | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=36&minLng=2&maxLat=37&maxLng=180.5` | maxLng above 180 | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=36&minLng=-181&maxLat=37&maxLng=4` | minLng below -180 | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=abc&minLng=2&maxLat=37&maxLng=4` | a word | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=NaN&minLng=2&maxLat=37&maxLng=4` | NaN | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=36&minLng=2&maxLat=Infinity&maxLng=4` | Infinity | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=-Infinity&minLng=2&maxLat=37&maxLng=4` | -Infinity | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=36&minLng=2&maxLat=1e2&maxLng=4` | exponent notation above the range (1e2 = 100) | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=3.6e1&minLng=2&maxLat=3.7e1&maxLng=4` | exponent notation inside the range | no-500 | 200 |  |
| `/clients/map?minLat=0x24&minLng=2&maxLat=37&maxLng=4` | hexadecimal (0x24 = 36) | no-500 | 200 |  |
| `/clients/map?minLat=&minLng=2&maxLat=37&maxLng=4` | empty value | no-500 | 200 |  |
| `/clients/map?minLat=%20&minLng=2&maxLat=37&maxLng=4` | a space | no-500 | 200 |  |
| `/clients/map?minLat=36,5&minLng=2&maxLat=37&maxLng=4` | decimal comma | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=٣٦&minLng=2&maxLat=37&maxLng=4` | Arabic digits | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=1111111111111111111111111111111111111111111111111111111111111111111…` | 10 000 digits | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=36.1111111111111111111111111111111111111111111111111111111111111111…` | 10 000 decimals | no-500 | 200 |  |
| `/clients/map?minLat=36%00&minLng=2&maxLat=37&maxLng=4` | a NUL byte | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=null&minLng=2&maxLat=37&maxLng=4` | the word null | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=true&minLng=2&maxLat=37&maxLng=4` | the word true | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat=36&minLat=36.5&minLng=2&maxLat=37&maxLng=4` | minLat sent twice | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat[]=36&minLng=2&maxLat=37&maxLng=4` | minLat as an array | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?minLat[a]=36&minLng=2&maxLat=37&maxLng=4` | minLat as an object | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?sectorId=not-a-uuid` | sectorId not a uuid | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?assignedSellerId=' OR 1=1 --` | SQL in assignedSellerId | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?hasDebt=yes` | hasDebt=yes | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?includeInactive=1` | includeInactive=1 | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?search=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa…` | search of 101 characters | 400 | 400 | VALIDATION_FAILED |
| `/clients/map?search=%00` | search with a NUL byte | no-500 | 500 | INTERNAL_ERROR |
| `/clients/map?search=abc%00def` | search with a NUL byte inside | no-500 | 500 | INTERNAL_ERROR |
| `/clients/map?search=');DROP TABLE clients;--` | SQL in search | 200 | 200 |  |
| `/clients/map?search=%5C` | search = one backslash | 200 | 200 |  |
| `/clients/map?search=%E0%A4%A` | broken percent-encoding in search | no-500 | 200 |  |
| `/clients/map?search[]=a&search[]=b` | search as an array | no-500 | 200 |  |
| `/clients/map?tenantId=afe74b42-7cef-4ad6-808f-2911e721c333` | a tenantId parameter | no-500 | 200 |  |
| `/clients/nearby?` | no position | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=36.75` | lat without lng | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lng=3.06` | lng without lat | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=&lng=` | empty lat and lng | no-500 | 200 |  |
| `/clients/nearby?lat=90.1&lng=3` | lat above 90 | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=36&lng=-180.1` | lng below -180 | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=NaN&lng=3` | NaN | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=Infinity&lng=3` | Infinity | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=1e400&lng=3` | 1e400 | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=3.675e1&lng=3.06e0` | exponent notation inside the range | no-500 | 200 |  |
| `/clients/nearby?lat=36.75&lng=3.06&radiusM=99` | radiusM 99 | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=36.75&lng=3.06&radiusM=100` | radiusM 100 | 200 | 200 |  |
| `/clients/nearby?lat=36.75&lng=3.06&radiusM=50000` | radiusM 50 000 | 200 | 200 |  |
| `/clients/nearby?lat=36.75&lng=3.06&radiusM=50001` | radiusM 50 001 | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=36.75&lng=3.06&radiusM=-5` | radiusM negative | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=36.75&lng=3.06&radiusM=1000.5` | radiusM with decimals | no-500 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=36.75&lng=3.06&radiusM=abc` | radiusM a word | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=36.75&lng=3.06&limit=0` | limit 0 | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=36.75&lng=3.06&limit=1` | limit 1 | 200 | 200 |  |
| `/clients/nearby?lat=36.75&lng=3.06&limit=100` | limit 100 | 200 | 200 |  |
| `/clients/nearby?lat=36.75&lng=3.06&limit=101` | limit 101 | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=36.75&lng=3.06&limit=1.5` | limit 1.5 | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=36.75&lng=3.06&limit=-1` | limit -1 | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=36.75&lng=3.06&limit=9999999999999999999999999999999999999999999999…` | limit of 400 digits | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=90&lng=0` | the north pole | 200 | 200 |  |
| `/clients/nearby?lat=-90&lng=180` | the south pole at lng 180 | 200 | 200 |  |
| `/clients/nearby?lat=0&lng=0` | lat 0, lng 0 | 200 | 200 |  |
| `/clients/nearby?lat=36.75&lng=180&radiusM=50000` | on the antimeridian | 200 | 200 |  |
| `/clients/nearby?lat=89.9999&lng=-180&radiusM=50000` | next to the pole | 200 | 200 |  |
| `/clients/nearby?lat=1&lat=2&lng=3` | lat sent twice | 400 | 400 | VALIDATION_FAILED |
| `/clients/nearby?lat=36.75&lng=3.06&search=%00` | nearby search with a NUL byte | no-500 | 500 | INTERNAL_ERROR |
| `/clients?hasLocation=true&search=%00` | list search with a NUL byte (older route, for comparison) | no-500 | 500 | INTERNAL_ERROR |
