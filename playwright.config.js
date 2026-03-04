// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30000,

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8080',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
    },
  ],

  webServer: [
    {
      // Serve the static frontend
      command: 'npx http-server . -p 8080 -c-1 --silent',
      port: 8080,
      reuseExistingServer: !process.env.CI,
    },
    {
      // Stripe backend (uses test keys)
      command: 'node server/index.js',
      port: 4242,
      reuseExistingServer: !process.env.CI,
      env: {
        STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder',
        ALLOWED_ORIGIN: 'http://localhost:8080',
        PORT: '4242',
      },
    },
  ],
});
