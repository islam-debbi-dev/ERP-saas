import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (apps/web/Dockerfile).
  output: 'standalone',
  // Trace files from the monorepo root so @erp/shared is included in the standalone output.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
