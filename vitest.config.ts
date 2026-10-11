import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

/**
 * Two projects: pure logic runs in Node; anything touching WebGL, Canvas, Web Audio, or the DOM runs in real headless
 * Chromium (SwiftShader WebGL, autoplay allowed) so rendering and sound are exercised without mocks.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
          environment: 'node',
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          testTimeout: 60_000,
          browser: {
            enabled: true,
            headless: true,
            screenshotFailures: false,
            provider: playwright({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } }),
            instances: [{ browser: 'chromium', viewport: { width: 1280, height: 800 } }],
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'html'],
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
