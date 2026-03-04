#!/usr/bin/env node
'use strict';

/**
 * Unit tests for the Stripe server — runs without Playwright.
 * Execute: node tests/stripe.unit.test.js
 */

const http = require('http');
const assert = require('assert');

// Set dummy env so server doesn't exit
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_unit_test_placeholder';
process.env.PORT = '0'; // random port
process.env.ALLOWED_ORIGIN = 'http://localhost:8080';

const { app } = require('../server/index.js');

let server;
let baseUrl;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { 'Content-Type': 'application/json', 'Origin': 'http://localhost:8080' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    return fn().then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    }).catch(err => {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    });
  }

  // Start server
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      console.log(`\nTest server on ${baseUrl}\n`);
      resolve();
    });
  });

  console.log('Health & CORS:');
  await test('GET /health returns ok', async () => {
    const res = await request('GET', '/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert(res.body.timestamp);
  });

  await test('CORS headers present', async () => {
    const res = await request('GET', '/health');
    assert(res.headers['access-control-allow-origin']);
  });

  console.log('\nCheckout Validation:');
  await test('POST /api/checkout rejects missing priceId', async () => {
    const res = await request('POST', '/api/checkout', {});
    assert.strictEqual(res.status, 400);
    assert(res.body.error.includes('priceId'));
  });

  await test('POST /api/checkout rejects empty body', async () => {
    const res = await request('POST', '/api/checkout', { quantity: 1 });
    assert.strictEqual(res.status, 400);
  });

  console.log('\nPayment Intent Validation:');
  await test('POST /api/payment-intent rejects amount < 50', async () => {
    const res = await request('POST', '/api/payment-intent', { amount: 10 });
    assert.strictEqual(res.status, 400);
    assert(res.body.error.includes('amount'));
  });

  await test('POST /api/payment-intent rejects missing amount', async () => {
    const res = await request('POST', '/api/payment-intent', {});
    assert.strictEqual(res.status, 400);
  });

  await test('POST /api/payment-intent rejects zero amount', async () => {
    const res = await request('POST', '/api/payment-intent', { amount: 0 });
    assert.strictEqual(res.status, 400);
  });

  console.log('\n────────────────────────────────────');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('────────────────────────────────────\n');

  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  if (server) server.close();
  process.exit(1);
});
