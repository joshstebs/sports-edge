// Billing — Stripe Checkout + Billing Portal, Stripe as source of truth (no DB).
// Subscription = $9.99/mo with a 7-day free trial. Customers are identified by
// email; the returned customer id is stored client-side and sent as the
// x-se-customer-id header on chat calls for live entitlement checks.
import { Router } from 'express';
import Stripe from 'stripe';

export const billingRouter = Router();

const stripe: Stripe | null = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

export const billingStripe: Stripe | null = stripe;

export async function customerIsEntitled(customerId: string): Promise<boolean> {
  if (!billingStripe || !customerId) return false;
  try {
    const subs = await billingStripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
    return subs.data.some(isEntitled);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('entitlement check error:', message);
    return false;
  }
}

const PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const TRIAL_DAYS = 7;
const APP_URL = process.env.APP_URL || 'https://sports-edge-kohl.vercel.app';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

function isEntitled(sub: Stripe.Subscription): boolean {
  return sub.status === 'trialing' || sub.status === 'active';
}

// POST /api/billing/checkout { email } -> { url, customerId }
// Creates/loads the Stripe customer by email, then returns a Checkout session
// URL (subscription mode, 7-day trial). Already-entitled customers get their
// billing portal URL instead of a second checkout.
billingRouter.post('/checkout', async (req, res) => {
  if (!stripe || !PRICE_ID) {
    return res.status(503).json({ error: 'Billing is not configured yet.' });
  }
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  try {
    const existing = (await stripe.customers.list({ email, limit: 1 })).data[0];
    const customer = existing ?? (await stripe.customers.create({ email, metadata: { app: 'sportsedge' } }));

    const subs = await stripe.subscriptions.list({ customer: customer.id, status: 'all', limit: 10 });
    if (subs.data.some(isEntitled)) {
      // Already on a trial/subscription — send them to manage it instead.
      const portal = await stripe.billingPortal.sessions.create({
        customer: customer.id,
        return_url: `${APP_URL}/`,
      });
      return res.json({ url: portal.url, customerId: customer.id, alreadyEntitled: true });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      subscription_data: { trial_period_days: TRIAL_DAYS },
      success_url: `${APP_URL}/?checkout=success`,
      cancel_url: `${APP_URL}/?checkout=canceled`,
      allow_promotion_codes: true,
    });

    res.json({ url: session.url, customerId: customer.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('checkout error:', message);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
});

// GET /api/billing/status?customer_id=cus_xxx -> live entitlement
billingRouter.get('/status', async (req, res) => {
  const customerId = String(req.query.customer_id || '');
  if (!stripe || !customerId) {
    return res.json({ entitled: false, status: 'none', customerId });
  }
  try {
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
    const sub = subs.data.find(isEntitled) || null;
    res.json({
      entitled: !!sub,
      status: sub ? sub.status : 'none',
      trialEndsAt: sub?.trial_end ?? null,
      periodEnd: sub ? ((sub as { current_period_end?: number | null }).current_period_end ?? null) : null,
      customerId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('billing status error:', message);
    res.json({ entitled: false, status: 'none', customerId });
  }
});

// POST /api/billing/portal { customerId } -> portal URL
billingRouter.post('/portal', async (req, res) => {
  const customerId = String(req.body?.customerId || '');
  if (!stripe || !customerId) {
    return res.status(400).json({ error: 'customerId is required.' });
  }
  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${APP_URL}/`,
    });
    res.json({ url: portal.url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('portal error:', message);
    res.status(500).json({ error: 'Could not open the billing portal.' });
  }
});

// POST /api/billing/webhook — Stripe event sink (checkout completed, subscription
// updated/deleted). Stripe is the source of truth, so we log + ack; clients poll
// /status live. Raw body comes from the global json verify() hook (req.rawBody).
billingRouter.post('/webhook', (req, res) => {
  const sig = req.get('stripe-signature') || '';
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!stripe || !secret) {
    return res.status(501).json({ error: 'Webhook is not configured.' });
  }
  let event: Stripe.Event;
  try {
    const raw = (req as { rawBody?: Buffer }).rawBody as Buffer | undefined;
    event = stripe.webhooks.constructEvent(raw ?? Buffer.from(''), sig, secret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('webhook signature verification failed:', message);
    return res.status(400).json({ error: `Signature verification failed: ${message}` });
  }
  console.log('stripe webhook:', event.type, event.id);
  res.json({ received: true });
});
