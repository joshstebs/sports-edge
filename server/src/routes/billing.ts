import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Router } from 'express';
import Stripe from 'stripe';
import { readCookie } from '../auth/session.js';

const CUSTOMER_COOKIE_NAME = '__Host-sportsedge_customer';
const CHECKOUT_COOKIE_NAME = '__Host-sportsedge_checkout';
const CUSTOMER_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const CHECKOUT_TTL_SECONDS = 60 * 60;
const PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const TRIAL_DAYS = 7;
const APP_URL = process.env.APP_URL || 'https://sports-edge-kohl.vercel.app';
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const CUSTOMER_ID_RE = /^cus_[A-Za-z0-9]+$/;
const CHECKOUT_SESSION_ID_RE = /^cs_(?:test|live)_[A-Za-z0-9]+$/;

const stripe: Stripe | null = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

export const billingStripe: Stripe | null = stripe;

interface CustomerTokenPayload {
  v: 1;
  customerId: string;
  exp: number;
}

function signature(encoded: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(`billing:${encoded}`).digest();
}

export function createCustomerToken(customerId: string, secret: string, nowMs = Date.now()): string {
  if (!CUSTOMER_ID_RE.test(customerId)) throw new Error('Invalid Stripe customer id.');
  const payload: CustomerTokenPayload = {
    v: 1,
    customerId,
    exp: Math.floor(nowMs / 1_000) + CUSTOMER_TOKEN_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${signature(encoded, secret).toString('base64url')}`;
}

export function verifyCustomerToken(token: unknown, secret: string, nowMs = Date.now()): string | null {
  if (typeof token !== 'string' || token.length > 2_048) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const supplied = Buffer.from(parts[1], 'base64url');
    if (supplied.toString('base64url') !== parts[1]) return null;
    const expected = signature(parts[0], secret);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const bytes = Buffer.from(parts[0], 'base64url');
    if (bytes.toString('base64url') !== parts[0]) return null;
    const payload = JSON.parse(bytes.toString('utf8')) as Partial<CustomerTokenPayload>;
    if (
      payload.v !== 1 ||
      !CUSTOMER_ID_RE.test(String(payload.customerId || '')) ||
      !Number.isInteger(payload.exp) ||
      Number(payload.exp) <= Math.floor(nowMs / 1_000)
    ) return null;
    return payload.customerId as string;
  } catch {
    return null;
  }
}

function customerCookie(token: string): string {
  return `${CUSTOMER_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${CUSTOMER_TOKEN_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

function expiredCustomerCookie(): string {
  return `${CUSTOMER_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

const CHECKOUT_STATE_RE = /^[A-Za-z0-9_-]{43}$/;

function checkoutStates(value: string | null | undefined): string[] {
  return (value || '').split('.').filter((state) => CHECKOUT_STATE_RE.test(state)).slice(-3);
}

function checkoutCookie(states: string[]): string {
  return `${CHECKOUT_COOKIE_NAME}=${encodeURIComponent(states.join('.'))}; Path=/; Max-Age=${CHECKOUT_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

function expiredCheckoutCookie(): string {
  return `${CHECKOUT_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function checkoutStateReference(state: string, secret: string): string {
  return createHmac('sha256', secret).update(`checkout-state:${state}`).digest('hex');
}

function customerSubject(customerId: string, secret: string): string {
  return createHmac('sha256', secret).update(`customer-subject:${customerId}`).digest('hex').slice(0, 24);
}

export function customerIdFromRequest(req: Pick<Request, 'headers'>, secret: string): string | null {
  return verifyCustomerToken(readCookie(req.headers.cookie, CUSTOMER_COOKIE_NAME), secret);
}

function isEntitled(sub: Stripe.Subscription): boolean {
  return sub.status === 'trialing' || sub.status === 'active';
}

export async function customerIsEntitled(customerId: string): Promise<boolean> {
  if (!billingStripe || !CUSTOMER_ID_RE.test(customerId)) return false;
  try {
    const subs = await billingStripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
    return subs.data.some(isEntitled);
  } catch (err: unknown) {
    console.error('entitlement check error:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

function noStore(res: { setHeader(name: string, value: string): unknown }): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
}

export function createBillingRouter(sessionSecret: string): Router {
  const router = Router();

  router.post('/checkout', async (req, res) => {
    noStore(res);
    if (!stripe || !PRICE_ID) return res.status(503).json({ error: 'Billing is not configured yet.' });
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || email.length > 320 || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }

    try {
      const existing = (await stripe.customers.list({ email, limit: 1 })).data[0];
      if (existing && await customerIsEntitled(existing.id)) {
        // Knowing an email address is not proof of account ownership.
        return res.status(409).json({
          error: 'This email already has an active subscription. Use the device where you completed checkout or contact support to recover access.',
          code: 'SUBSCRIPTION_EXISTS',
        });
      }
      const customer = existing ?? await stripe.customers.create({ email, metadata: { app: 'sportsedge' } });
      const browserState = randomBytes(32).toString('base64url');
      const browserStates = [...checkoutStates(readCookie(req.headers.cookie, CHECKOUT_COOKIE_NAME)), browserState].slice(-3);
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customer.id,
        line_items: [{ price: PRICE_ID, quantity: 1 }],
        subscription_data: { trial_period_days: TRIAL_DAYS },
        success_url: `${APP_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${APP_URL}/?checkout=canceled`,
        allow_promotion_codes: true,
        client_reference_id: checkoutStateReference(browserState, sessionSecret),
        expires_at: Math.floor(Date.now() / 1_000) + CHECKOUT_TTL_SECONDS,
      });
      if (!session.url) return res.status(502).json({ error: 'Stripe did not return a checkout URL.' });
      res.setHeader('Set-Cookie', checkoutCookie(browserStates));
      return res.json({ url: session.url });
    } catch (err: unknown) {
      console.error('checkout error:', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ error: 'Could not start checkout. Please try again.' });
    }
  });

  // Verify the unguessable Checkout Session directly with Stripe before
  // issuing a signed, HttpOnly customer credential to this browser.
  router.get('/complete', async (req, res) => {
    noStore(res);
    const sessionId = String(req.query.session_id || '');
    if (!stripe || !CHECKOUT_SESSION_ID_RE.test(sessionId)) {
      return res.status(400).json({ entitled: false, error: 'A valid checkout session is required.' });
    }
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
      const suppliedReference = session.client_reference_id || '';
      const states = checkoutStates(readCookie(req.headers.cookie, CHECKOUT_COOKIE_NAME));
      const matchedState = states.find((state) => {
        const expectedReference = checkoutStateReference(state, sessionSecret);
        return expectedReference.length === suppliedReference.length && timingSafeEqual(Buffer.from(expectedReference), Buffer.from(suppliedReference));
      });
      if (!matchedState) return res.status(403).json({ entitled: false, error: 'Checkout was not initiated by this browser.' });
      if (session.mode !== 'subscription' || session.status !== 'complete' || !customerId || !await customerIsEntitled(customerId)) {
        return res.status(409).json({ entitled: false, error: 'Checkout is not complete or the subscription is not active.' });
      }
      const remainingStates = states.filter((state) => state !== matchedState);
      res.setHeader('Set-Cookie', [customerCookie(createCustomerToken(customerId, sessionSecret)), remainingStates.length ? checkoutCookie(remainingStates) : expiredCheckoutCookie()]);
      return res.json({ entitled: true, status: 'active', subject: customerSubject(customerId, sessionSecret) });
    } catch (err: unknown) {
      console.error('checkout completion error:', err instanceof Error ? err.message : String(err));
      return res.status(400).json({ entitled: false, error: 'Checkout could not be verified.' });
    }
  });

  router.get('/status', async (req, res) => {
    noStore(res);
    const customerId = customerIdFromRequest(req, sessionSecret);
    if (!stripe || !customerId) return res.json({ entitled: false, status: 'none', trialEndsAt: null, periodEnd: null, subject: null });
    try {
      const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 10 });
      const sub = subs.data.find(isEntitled) || null;
      return res.json({
        entitled: Boolean(sub),
        status: sub?.status ?? 'none',
        trialEndsAt: sub?.trial_end ?? null,
        periodEnd: sub ? ((sub as { current_period_end?: number | null }).current_period_end ?? null) : null,
        subject: sub ? customerSubject(customerId, sessionSecret) : null,
      });
    } catch (err: unknown) {
      console.error('billing status error:', err instanceof Error ? err.message : String(err));
      return res.json({ entitled: false, status: 'none', trialEndsAt: null, periodEnd: null, subject: null });
    }
  });

  router.post('/portal', async (req, res) => {
    noStore(res);
    const customerId = customerIdFromRequest(req, sessionSecret);
    if (!stripe || !customerId) return res.status(401).json({ error: 'A verified subscriber session is required.' });
    try {
      const portal = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${APP_URL}/` });
      return res.json({ url: portal.url });
    } catch (err: unknown) {
      console.error('portal error:', err instanceof Error ? err.message : String(err));
      return res.status(500).json({ error: 'Could not open the billing portal.' });
    }
  });

  router.post('/logout', (_req, res) => {
    noStore(res);
    res.setHeader('Set-Cookie', expiredCustomerCookie());
    res.json({ ok: true });
  });

  router.post('/webhook', (req, res) => {
    const sig = req.get('stripe-signature') || '';
    const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
    if (!stripe || !secret) return res.status(501).json({ error: 'Webhook is not configured.' });
    try {
      const raw = (req as { rawBody?: Buffer }).rawBody as Buffer | undefined;
      const event = stripe.webhooks.constructEvent(raw ?? Buffer.from(''), sig, secret);
      console.log('stripe webhook:', event.type, event.id);
      return res.json({ received: true });
    } catch (err: unknown) {
      console.error('webhook signature verification failed:', err instanceof Error ? err.message : String(err));
      return res.status(400).json({ error: 'Webhook signature verification failed.' });
    }
  });

  return router;
}
