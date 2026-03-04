#!/usr/bin/env node
'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const Stripe = require('stripe');

const PORT = process.env.PORT || 4242;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://blackboxprogramming.github.io';

if (!STRIPE_SECRET_KEY) {
  console.error('FATAL: STRIPE_SECRET_KEY is required. Set it in .env or environment.');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-04-10' });
const app = express();

// ── Middleware ──────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

// Raw body needed for webhook signature verification — mount BEFORE json parser
app.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// JSON parser for all other routes
app.use(express.json());

// ── Health check ───────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Products / Prices ──────────────────────────────────────────────
app.get('/api/products', async (_req, res) => {
  try {
    const prices = await stripe.prices.list({
      active: true,
      expand: ['data.product'],
      limit: 20,
    });
    const products = prices.data
      .filter(p => p.product && typeof p.product === 'object' && p.product.active)
      .map(p => ({
        id: p.id,
        productId: p.product.id,
        name: p.product.name,
        description: p.product.description,
        amount: p.unit_amount,
        currency: p.currency,
        recurring: p.recurring,
        image: p.product.images?.[0] || null,
      }));
    res.json({ products });
  } catch (err) {
    console.error('GET /api/products error:', err.message);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// ── Create Checkout Session ────────────────────────────────────────
app.post('/api/checkout', async (req, res) => {
  const { priceId, quantity, successUrl, cancelUrl } = req.body;

  if (!priceId) {
    return res.status(400).json({ error: 'priceId is required' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price: priceId,
        quantity: quantity || 1,
      }],
      success_url: successUrl || `${ALLOWED_ORIGIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${ALLOWED_ORIGIN}/#pricing`,
    });
    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('POST /api/checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ── Create Payment Intent (for custom flows) ───────────────────────
app.post('/api/payment-intent', async (req, res) => {
  const { amount, currency } = req.body;

  if (!amount || amount < 50) {
    return res.status(400).json({ error: 'amount must be at least 50 (cents)' });
  }

  try {
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency: currency || 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: { source: 'blackboxprogramming' },
    });
    res.json({ clientSecret: intent.client_secret, intentId: intent.id });
  } catch (err) {
    console.error('POST /api/payment-intent error:', err.message);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

// ── Retrieve session (for success page) ────────────────────────────
app.get('/api/session/:id', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.id, {
      expand: ['line_items', 'payment_intent'],
    });
    res.json({
      status: session.payment_status,
      customerEmail: session.customer_details?.email,
      amountTotal: session.amount_total,
      currency: session.currency,
    });
  } catch (err) {
    console.error('GET /api/session error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve session' });
  }
});

// ── Stripe Webhook Handler ─────────────────────────────────────────
async function handleWebhook(req, res) {
  let event;

  if (STRIPE_WEBHOOK_SECRET) {
    const sig = req.headers['stripe-signature'];
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  } else {
    console.warn('STRIPE_WEBHOOK_SECRET not set — skipping signature verification');
    event = JSON.parse(req.body);
  }

  console.log(`Webhook received: ${event.type} [${event.id}]`);

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      console.log(`Payment completed: ${session.id} — $${(session.amount_total / 100).toFixed(2)} ${session.currency}`);
      // TODO: Fulfill order — update DB, send email, provision access, etc.
      break;
    }
    case 'payment_intent.succeeded': {
      const intent = event.data.object;
      console.log(`PaymentIntent succeeded: ${intent.id}`);
      break;
    }
    case 'payment_intent.payment_failed': {
      const intent = event.data.object;
      console.error(`PaymentIntent failed: ${intent.id} — ${intent.last_payment_error?.message}`);
      break;
    }
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
}

// ── Start ──────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BlackRoad Stripe server running on http://0.0.0.0:${PORT}`);
    console.log(`Allowed origin: ${ALLOWED_ORIGIN}`);
    console.log(`Webhook endpoint: POST /webhook`);
  });
}

module.exports = { app, stripe };
