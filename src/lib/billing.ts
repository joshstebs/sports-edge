// Billing helpers — Stripe Checkout trial flow, Stripe as source of truth.
// The Stripe customer id is stored on this device and sent with chat calls so
// the server can verify entitlement live (x-se-customer-id header).
const CUSTOMER_KEY = 'sportsedge.customerId';

export interface BillingStatus {
  entitled: boolean;
  status: string; // 'trialing' | 'active' | 'none' | ...
  trialEndsAt: number | null;
  periodEnd: number | null;
  customerId: string;
}

export function getCustomerId(): string {
  try {
    return localStorage.getItem(CUSTOMER_KEY) || '';
  } catch {
    return '';
  }
}

export function setCustomerId(id: string): void {
  try {
    localStorage.setItem(CUSTOMER_KEY, id);
  } catch {
    /* storage unavailable */
  }
}

export function clearCustomerId(): void {
  try {
    localStorage.removeItem(CUSTOMER_KEY);
  } catch {
    /* storage unavailable */
  }
}

export async function fetchBillingStatus(): Promise<BillingStatus> {
  const customerId = getCustomerId();
  if (!customerId) {
    return { entitled: false, status: 'none', trialEndsAt: null, periodEnd: null, customerId: '' };
  }
  try {
    const res = await fetch(
      `${import.meta.env.BASE_URL}api/billing/status?customer_id=${encodeURIComponent(customerId)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) {
      return { entitled: false, status: 'none', trialEndsAt: null, periodEnd: null, customerId };
    }
    const body = (await res.json()) as Partial<BillingStatus>;
    return {
      entitled: !!body.entitled,
      status: body.status || 'none',
      trialEndsAt: body.trialEndsAt ?? null,
      periodEnd: body.periodEnd ?? null,
      customerId,
    };
  } catch {
    return { entitled: false, status: 'none', trialEndsAt: null, periodEnd: null, customerId };
  }
}

export async function startCheckout(email: string): Promise<{ url: string; customerId: string }> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/billing/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    url?: string;
    customerId?: string;
    error?: string;
  };
  if (!res.ok || !body.url || !body.customerId) {
    throw new Error(body.error || `Checkout failed (HTTP ${res.status})`);
  }
  return { url: body.url, customerId: body.customerId };
}

export async function openPortal(customerId: string): Promise<string> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/billing/portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ customerId }),
  });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) {
    throw new Error(body.error || `Portal failed (HTTP ${res.status})`);
  }
  return body.url;
}
