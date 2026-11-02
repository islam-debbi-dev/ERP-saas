import type { Config } from 'jest';

const shared = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  // The generated Prisma client imports `./x.js`; map back to the .ts source.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
};

const config: Config = {
  // One worker: integration tests share one database (each test uses its own tenants).
  maxWorkers: 1,
  // Run that one worker as a child process and restart it when a suite leaves it above
  // 1 GB: in one process the memory of ~45 suites piles up past Node's 2 GB heap.
  workerIdleMemoryLimit: '1GB',
  projects: [
    {
      ...shared,
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/scripts/**/*.spec.ts'],
    },
    {
      ...shared,
      displayName: 'integration',
      testMatch: ['<rootDir>/test/**/*.int-spec.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
      setupFiles: ['<rootDir>/test/setup-env.ts'],
    },
  ],
};

export default config;
