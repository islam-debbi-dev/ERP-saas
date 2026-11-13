# The position in the API log and in the Sentry payloads

API built from the audited commit, `LOG_LEVEL=info`, `SENTRY_DSN` → a local sink. 1077 log lines, 51 Sentry envelopes. Each variant was sent 40 times with its own coordinates.

| Variant | Request | HTTP | In the pino log | In a Sentry payload |
|---|---|---|---|---|
| direct | `/clients/nearby?lat=36.710137&lng=3.020151&radiusM=5000&limit=30` | 200 | no | **yes** |
| filters | `/clients/nearby?hasDebt=true&search=caf%C3%A9&radiusM=10000&lat=36.710274&lng=3.020302` | 200 | no | **yes** |
| proxy | `/api/clients/nearby?lat=36.710411&lng=3.020453&radiusM=5000` (via the rewrite) | 200 | no | **yes** |
| invalid | `/clients/nearby?lat=36.710548&lng=3.020604&radiusM=abc` | 400 | no | **yes** |
| error500 | `/clients/nearby?lat=36.710685&lng=3.020755&search=%00` | 500 | no | **yes** |
| no-token | `/clients/nearby?lat=36.710822&lng=3.020906` | 401 | no | **yes** |
| slash | `/clients/nearby/?lat=36.710959&lng=3.021057` | 200 | **yes, 40 lines** | **yes** |
| upper | `/Clients/Nearby?lat=36.711096&lng=3.021208` | 200 | **yes, 40 lines** | **yes** |
| double | `//clients/nearby?lat=36.711233&lng=3.021359` | 404 | **yes, 40 lines** | **yes** |
| encoded | `/clients%2Fnearby?lat=36.711370&lng=3.021510` | 404 | **yes, 40 lines** | no |
| twice | `/clients/nearby?lat=1&lat=36.711507&lng=3.021661` | 400 | no | **yes** |
| case-param | `/clients/nearby?Lat=36.711644&Lng=3.021812&lat=1&lng=1` | 200 | **yes, 40 lines** | **yes** |
| fragment | `/clients/nearby;x=1?lat=36.711781&lng=3.021963` | 400 | **yes, 40 lines** | **yes** |
| map-box | `/clients/map?minLat=36.711918&minLng=3.022114&maxLat=36.9&maxLng=3.3` | 200 | **yes, 40 lines** | **yes** |

## Samples

### log — slash

```
":1794442131045,"pid":32965,"hostname":"Islams-MacBook-Air.local","req":{"id":"cb22f918-5464-4d74-9365-06007c963a3d","method":"GET","url":"/clients/nearby/?lat=36.710959&lng=3.021057","query":{"lat":"36.710959","lng":"3.021057"},"params":{"path":["clients","nearby",""]},"headers":{"host":"localhost:3013","connection":"keep-alive","authorization":"[Redacted]","accept":"*/*","accept-language":"*","sec-fetch-mode":"cors
```

### log — upper

```
e":1794442131380,"pid":32965,"hostname":"Islams-MacBook-Air.local","req":{"id":"668c73cc-d648-4469-9d8f-0530772d1645","method":"GET","url":"/Clients/Nearby?lat=36.711096&lng=3.021208","query":{"lat":"36.711096","lng":"3.021208"},"params":{"path":["Clients","Nearby"]},"headers":{"host":"localhost:3013","connection":"keep-alive","authorization":"[Redacted]","accept":"*/*","accept-language":"*","sec-fetch-mode":"cors","
```

### log — double

```
":1794442131709,"pid":32965,"hostname":"Islams-MacBook-Air.local","req":{"id":"de766d29-6733-4a2a-8674-2a1e02a13c23","method":"GET","url":"//clients/nearby?lat=36.711233&lng=3.021359","query":{"lat":"36.711233","lng":"3.021359"},"params":{"path":["","clients","nearby"]},"headers":{"host":"localhost:3013","connection":"keep-alive","authorization":"[Redacted]","accept":"*/*","accept-language":"*","sec-fetch-mode":"cors
```

### log — encoded

```
:1794442131743,"pid":32965,"hostname":"Islams-MacBook-Air.local","req":{"id":"7d346562-a444-4069-98e1-afce3098d9cf","method":"GET","url":"/clients%2Fnearby?lat=36.711370&lng=3.021510","query":{"lat":"36.711370","lng":"3.021510"},"params":{"path":["clients/nearby"]},"headers":{"host":"localhost:3013","connection":"keep-alive","authorization":"[Redacted]","accept":"*/*","accept-language":"*","sec-fetch-mode":"cors","us
```

### log — case-param

```
e":1794442131881,"pid":32965,"hostname":"Islams-MacBook-Air.local","req":{"id":"19b1b1a5-6f39-4cbb-9938-66a5e7c8b35d","method":"GET","url":"/clients/nearby?Lat=36.711644&Lng=3.021812","query":{"Lat":"36.711644","Lng":"3.021812"},"params":{"path":["clients","nearby"]},"headers":{"host":"localhost:3013","connection":"keep-alive","authorization":"[Redacted]","accept":"*/*","accept-language":"*","sec-fetch-mode":"cors","
```

### log — fragment

```
794442132143,"pid":32965,"hostname":"Islams-MacBook-Air.local","req":{"id":"7c758fcd-d1da-440f-afcf-09fc1a0238cf","method":"GET","url":"/clients/nearby;x=1?lat=36.711781&lng=3.021963","query":{"lat":"36.711781","lng":"3.021963"},"params":{"path":["clients","nearby;x=1"]},"headers":{"host":"localhost:3013","connection":"keep-alive","authorization":"[Redacted]","accept":"*/*","accept-language":"*","sec-fetch-mode":"cor
```

### log — map-box

```
e":1794442132278,"pid":32965,"hostname":"Islams-MacBook-Air.local","req":{"id":"49c4f19b-9a33-44ac-8089-bab02ed286d2","method":"GET","url":"/clients/map?minLat=36.711918&minLng=3.022114&maxLat=36.9&maxLng=3.3","query":{"minLat":"36.711918","minLng":"3.022114","maxLat":"36.9","maxLng":"3.3"},"params":{"path":["clients","map"]},"headers":{"host":"localhost:3013","connection":"keep-alive","authorization":"[Redacted]","a
```

### Sentry — direct

```
alue":"ClientsController","type":"string"},"nestjs.callback":{"value":"nearby","type":"string"},"nestjs.version":{"value":"11.2.7","type":"string"},"http.route":{"value":"/clients/nearby","type":"string"},"http.request.method":{"value":"GET","type":"string"},"url.full":{"value":"/clients/nearby?lat=36.710137&lng=3.020151&radiusM=5000&limit=30","type":"string"},"sentry.trace_lifecycle":{"value":"stream","type":"string"},"sentry.segment.name":{"value":"GET /clients/nearby","type":"string"},"sentry
```

### Sentry — filters

```
nestjs.callback":{"value":"nearby","type":"string"},"nestjs.version":{"value":"11.2.7","type":"string"},"http.route":{"value":"/clients/nearby","type":"string"},"http.request.method":{"value":"GET","type":"string"},"url.full":{"value":"/clients/nearby?hasDebt=true&search=caf%C3%A9&radiusM=10000&lat=36.710274&lng=3.020302","type":"string"},"sentry.trace_lifecycle":{"value":"stream","type":"string"},"sentry.segment.name":{"value":"GET /clients/nearby","type":"string"},"sentry.segment.id":{"value":
```

### Sentry — proxy

```
alue":"ClientsController","type":"string"},"nestjs.callback":{"value":"nearby","type":"string"},"nestjs.version":{"value":"11.2.7","type":"string"},"http.route":{"value":"/clients/nearby","type":"string"},"http.request.method":{"value":"GET","type":"string"},"url.full":{"value":"/clients/nearby?lat=36.710411&lng=3.020453&radiusM=5000","type":"string"},"sentry.trace_lifecycle":{"value":"stream","type":"string"},"sentry.segment.name":{"value":"GET /clients/nearby","type":"string"},"sentry.segment.
```

### Sentry — invalid

```
alue":"ClientsController","type":"string"},"nestjs.callback":{"value":"nearby","type":"string"},"nestjs.version":{"value":"11.2.7","type":"string"},"http.route":{"value":"/clients/nearby","type":"string"},"http.request.method":{"value":"GET","type":"string"},"url.full":{"value":"/clients/nearby?lat=36.710548&lng=3.020604&radiusM=abc","type":"string"},"sentry.trace_lifecycle":{"value":"stream","type":"string"},"sentry.segment.name":{"value":"GET /clients/nearby","type":"string"},"sentry.segment.i
```

### Sentry — error500

```
ET /clients/nearby","request":{"headers":{"host":"localhost:3013","connection":"keep-alive","authorization":"[Filtered]","accept":"*/*","accept-language":"*","sec-fetch-mode":"cors","user-agent":"node","accept-encoding":"gzip, deflate"},"method":"GET","url":"http://localhost:3013/clients/nearby?lat=36.710685&lng=3.020755&search=%00","cookies":{},"query_string":"lat=36.710685&lng=3.020755&search=%00"},"user":{"ip_address":"::1"},"modules":{"@anthropic-ai/sdk":"^1.4.0","@erp/shared":"workspace:*",
```

### Sentry — no-token

```
alue":"ClientsController","type":"string"},"nestjs.callback":{"value":"nearby","type":"string"},"nestjs.version":{"value":"11.2.7","type":"string"},"http.route":{"value":"/clients/nearby","type":"string"},"http.request.method":{"value":"GET","type":"string"},"url.full":{"value":"/clients/nearby?lat=36.710822&lng=3.020906","type":"string"},"sentry.trace_lifecycle":{"value":"stream","type":"string"},"sentry.segment.name":{"value":"GET /clients/nearby","type":"string"},"sentry.segment.id":{"value":
```

### Sentry — slash

```
lue":"ClientsController","type":"string"},"nestjs.callback":{"value":"nearby","type":"string"},"nestjs.version":{"value":"11.2.7","type":"string"},"http.route":{"value":"/clients/nearby","type":"string"},"http.request.method":{"value":"GET","type":"string"},"url.full":{"value":"/clients/nearby/?lat=36.710959&lng=3.021057","type":"string"},"sentry.trace_lifecycle":{"value":"stream","type":"string"},"sentry.segment.name":{"value":"GET /clients/nearby","type":"string"},"sentry.segment.id":{"value":
```

### Sentry — upper

```
alue":"ClientsController","type":"string"},"nestjs.callback":{"value":"nearby","type":"string"},"nestjs.version":{"value":"11.2.7","type":"string"},"http.route":{"value":"/clients/nearby","type":"string"},"http.request.method":{"value":"GET","type":"string"},"url.full":{"value":"/Clients/Nearby?lat=36.711096&lng=3.021208","type":"string"},"sentry.trace_lifecycle":{"value":"stream","type":"string"},"sentry.segment.name":{"value":"GET /*path","type":"string"},"sentry.segment.id":{"value":"aff24e56
```

### Sentry — double

```
ver","type":"string"},"sentry.op":{"value":"http.server","type":"string"},"sentry.segment.name.source":{"value":"route","type":"string"},"sentry.sample_rate":{"value":0.1,"type":"double"},"sentry.kind":{"value":"server","type":"string"},"url.full":{"value":"http://localhost:3013//clients/nearby?lat=36.711233&lng=3.021359","type":"string"},"url.path":{"value":"//clients/nearby","type":"string"},"url.query":{"value":"lat=36.711233&lng=3.021359","type":"string"},"http.request.method":{"value":"GET"
```

### Sentry — twice

```
"ClientsController","type":"string"},"nestjs.callback":{"value":"nearby","type":"string"},"nestjs.version":{"value":"11.2.7","type":"string"},"http.route":{"value":"/clients/nearby","type":"string"},"http.request.method":{"value":"GET","type":"string"},"url.full":{"value":"/clients/nearby?lat=1&lat=36.711507&lng=3.021661","type":"string"},"sentry.trace_lifecycle":{"value":"stream","type":"string"},"sentry.segment.name":{"value":"GET /clients/nearby","type":"string"},"sentry.segment.id":{"value":
```

### Sentry — case-param

```
alue":"ClientsController","type":"string"},"nestjs.callback":{"value":"nearby","type":"string"},"nestjs.version":{"value":"11.2.7","type":"string"},"http.route":{"value":"/clients/nearby","type":"string"},"http.request.method":{"value":"GET","type":"string"},"url.full":{"value":"/clients/nearby?Lat=36.711644&Lng=3.021812&lat=1&lng=1","type":"string"},"sentry.trace_lifecycle":{"value":"stream","type":"string"},"sentry.segment.name":{"value":"GET /clients/nearby","type":"string"},"sentry.segment.i
```

### Sentry — fragment

```
"value":"ClientsController","type":"string"},"nestjs.callback":{"value":"get","type":"string"},"nestjs.version":{"value":"11.2.7","type":"string"},"http.route":{"value":"/clients/:id","type":"string"},"http.request.method":{"value":"GET","type":"string"},"url.full":{"value":"/clients/nearby;x=1?lat=36.711781&lng=3.021963","type":"string"},"sentry.trace_lifecycle":{"value":"stream","type":"string"},"sentry.segment.name":{"value":"GET /clients/:id","type":"string"},"sentry.segment.id":{"value":"93
```

### Sentry — map-box

```
r":{"value":"ClientsController","type":"string"},"nestjs.callback":{"value":"map","type":"string"},"nestjs.version":{"value":"11.2.7","type":"string"},"http.route":{"value":"/clients/map","type":"string"},"http.request.method":{"value":"GET","type":"string"},"url.full":{"value":"/clients/map?minLat=36.711918&minLng=3.022114&maxLat=36.9&maxLng=3.3","type":"string"},"sentry.trace_lifecycle":{"value":"stream","type":"string"},"sentry.segment.name":{"value":"GET /clients/map","type":"string"},"sentr
```
