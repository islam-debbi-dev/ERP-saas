import { buildFixture, uniq } from './api/fixture.ts';
import { request } from './lib/http.ts';

const f = await buildFixture('Probe invite');
const email = uniq('probe') + '@audit.local';
const res = await request('/users/invite', {
  method: 'POST',
  token: f.session.token,
  body: { fullName: 'Probe user', email, role: 'SELLER', mode: 'PASSWORD', password: 'Temp1234!' },
});
console.log('invite ->', res.status, res.raw.slice(0, 300));

const reg = await request('/auth/register', {
  method: 'POST',
  headers: { 'X-Client-Type': 'native' },
  body: { companyName: 'Probe Co ' + uniq('c'), fullName: 'Owner', email: uniq('r') + '@audit.local', password: 'Owner1234!' },
});
console.log('register ->', reg.status, reg.raw.slice(0, 200));
