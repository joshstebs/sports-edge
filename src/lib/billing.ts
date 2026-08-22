export interface BillingStatus {
  entitled: boolean;
  status: string;
  trialEndsAt: number | null;
  periodEnd: number | null;
  subject: string | null;
}

const EMPTY_STATUS: BillingStatus = {
  entitled: false,
  status: 'none',
  trialEndsAt: null,
  periodEnd: null,
  subject: null,
};

async function billingJson(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${import.meta.env.BASE_URL}api/billing/${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  });
}

export async function completeCheckout(sessionId: string): Promise<BillingStatus> {
  const res = await billingJson(`complete?session_id=${encodeURIComponent(sessionId)}`);
  const body = (await res.json().catch(() => ({}))) as Partial<BillingStatus> & { error?: string };
  if (!res.ok || !body.entitled) throw new Error(body.error || 'Checkout could not be verified.');
  return { ...EMPTY_STATUS, ...body, entitled: true };
}

export async function fetchBillingStatus(): Promise<BillingStatus> {
  try {
    const res = await billingJson('status');
    if (!res.ok) return EMPTY_STATUS;
    const body = (await res.json()) as Partial<BillingStatus>;
    return {
      entitled: Boolean(body.entitled),
      status: body.status || 'none',
      trialEndsAt: body.trialEndsAt ?? null,
      periodEnd: body.periodEnd ?? null,
      subject: typeof body.subject === 'string' ? body.subject : null,
    };
  } catch {
    return EMPTY_STATUS;
  }
}

export async function startCheckout(email: string): Promise<{ url: string }> {
  const res = await billingJson('checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error || `Checkout failed (HTTP ${res.status})`);
  return { url: body.url };
}

export async function openPortal(): Promise<string> {
  const res = await billingJson('portal', { method: 'POST' });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error || `Portal failed (HTTP ${res.status})`);
  return body.url;
}

export async function clearBillingSession(): Promise<void> {
  await billingJson('logout', { method: 'POST' });
}
