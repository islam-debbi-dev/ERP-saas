import nextVitals from 'eslint-config-next/core-web-vitals';
import root from '../../eslint.config.mjs';

// Next.js rules first, then the shared TypeScript rules so they win on .ts/.tsx files.
const config = [...nextVitals, ...root, { ignores: ['.next/**', 'next-env.d.ts'] }];

export default config;
