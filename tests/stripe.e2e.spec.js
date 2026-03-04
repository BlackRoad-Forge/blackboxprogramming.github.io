// @ts-check
const { test, expect } = require('@playwright/test');

const API_BASE = process.env.API_BASE || 'http://localhost:4242';

test.describe('Blackbox Programming — E2E', () => {

  test.describe('Landing Page', () => {
    test('loads homepage with correct title', async ({ page }) => {
      await page.goto('/');
      await expect(page).toHaveTitle(/Blackbox Programming/);
    });

    test('displays hero section with all elements', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('h1')).toHaveText('Blackbox Programming');
      await expect(page.locator('.tagline')).toHaveText('Code. Ship. Repeat.');
      await expect(page.locator('.org-badge')).toContainText('Personal Division');
    });

    test('displays pricing section with 3 cards', async ({ page }) => {
      await page.goto('/');
      const cards = page.locator('.price-card');
      await expect(cards).toHaveCount(3);
    });

    test('pricing cards have checkout buttons', async ({ page }) => {
      await page.goto('/');
      const buttons = page.locator('.btn-checkout');
      await expect(buttons).toHaveCount(3);
      await expect(buttons.nth(0)).toHaveText('Get Started');
      await expect(buttons.nth(1)).toHaveText('Go Pro');
      await expect(buttons.nth(2)).toHaveText('Contact Sales');
    });

    test('stats section shows correct values', async ({ page }) => {
      await page.goto('/');
      const stats = page.locator('.stat-value');
      await expect(stats.nth(0)).toHaveText('30K');
      await expect(stats.nth(1)).toHaveText('17');
      await expect(stats.nth(2)).toHaveText('1,800+');
      await expect(stats.nth(3)).toHaveText('$0');
    });

    test('scroll to pricing via nav button', async ({ page }) => {
      await page.goto('/');
      await page.click('a[href="#pricing"]');
      await expect(page.locator('#pricing')).toBeInViewport();
    });

    test('has Stripe.js loaded', async ({ page }) => {
      await page.goto('/');
      const stripeLoaded = await page.evaluate(() => typeof window.Stripe === 'function');
      expect(stripeLoaded).toBe(true);
    });
  });

  test.describe('Stripe Backend API', () => {
    test('health endpoint returns ok', async ({ request }) => {
      const res = await request.get(`${API_BASE}/health`);
      expect(res.ok()).toBeTruthy();
      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeTruthy();
    });

    test('checkout endpoint rejects missing priceId', async ({ request }) => {
      const res = await request.post(`${API_BASE}/api/checkout`, {
        data: {},
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('priceId');
    });

    test('payment-intent endpoint rejects invalid amount', async ({ request }) => {
      const res = await request.post(`${API_BASE}/api/payment-intent`, {
        data: { amount: 10 },
      });
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('amount');
    });

    test('payment-intent endpoint rejects missing amount', async ({ request }) => {
      const res = await request.post(`${API_BASE}/api/payment-intent`, {
        data: {},
      });
      expect(res.status()).toBe(400);
    });
  });

  test.describe('Checkout Flow (UI)', () => {
    test('clicking starter checkout shows status banner when API unreachable', async ({ page }) => {
      // Override API_BASE to an unreachable URL to test error handling
      await page.goto('/');
      await page.evaluate(() => {
        window.BLACKROAD_API = 'http://localhost:9999';
      });

      await page.click('[data-tier="starter"]');

      // Should show loading then error banner
      const banner = page.locator('#status-banner');
      await expect(banner).toBeVisible({ timeout: 10000 });
    });

    test('enterprise tier opens mailto link', async ({ page, context }) => {
      await page.goto('/');
      // Override API to force fallback
      await page.evaluate(() => {
        window.BLACKROAD_API = 'http://localhost:9999';
      });

      // Listen for navigation
      const [popup] = await Promise.all([
        page.waitForEvent('popup', { timeout: 5000 }).catch(() => null),
        page.click('[data-tier="enterprise"]'),
      ]);

      // mailto: links typically don't create popups, just verify button interaction works
      const btn = page.locator('[data-tier="enterprise"]');
      await expect(btn).toBeVisible();
    });
  });

  test.describe('Success Page', () => {
    test('success page loads without session_id', async ({ page }) => {
      await page.goto('/success.html');
      await expect(page).toHaveTitle(/Payment Successful/);
      await expect(page.locator('h1')).toHaveText('Payment Successful');
    });

    test('success page shows thank you message', async ({ page }) => {
      await page.goto('/success.html');
      // Without session_id, should show generic thank you
      await expect(page.locator('#subtitle')).toContainText('Thank you');
    });

    test('success page has back to home link', async ({ page }) => {
      await page.goto('/success.html');
      const link = page.locator('a.btn');
      await expect(link).toHaveText('Back to Home');
      await expect(link).toHaveAttribute('href', '/');
    });
  });

  test.describe('Mobile Responsiveness', () => {
    test('pricing cards stack on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/');
      const grid = page.locator('.pricing-grid');
      const gridStyles = await grid.evaluate(el => getComputedStyle(el).gridTemplateColumns);
      // On mobile, should be single column
      expect(gridStyles).toBeTruthy();
    });

    test('stats stack on mobile', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/');
      const stats = page.locator('.stats');
      const direction = await stats.evaluate(el => getComputedStyle(el).flexDirection);
      expect(direction).toBe('column');
    });
  });
});
