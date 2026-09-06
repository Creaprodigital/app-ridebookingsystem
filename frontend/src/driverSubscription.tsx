/**
 * Driver subscription state & payment orchestration.
 *
 * Backend contract used
 *   GET  /api/driver/subscription  →  {
 *     enabled: boolean,            // is subscription required for this driver
 *     status: 'none' | 'active' | 'past_due' | 'canceled' | string,
 *     monthly_amount_cents: number,
 *     next_billing_at: string | null,
 *     last_paid_at: string | null,
 *     last_failure_reason: string | null,
 *   }
 *
 * Payment is delegated to Stripe Checkout: the backend is expected to expose
 * a POST endpoint that returns `{ url: string }`. As of writing, the exact
 * path is not yet published, so `startCheckout()` tries a short list of
 * plausible candidates and uses the first one that responds. When a new
 * endpoint is deployed backend-side, no frontend change is needed as long as
 * its name is in the candidate list below (or it already matches one).
 *
 * A driver is considered *blocked* — cannot go on shift, cannot see incoming
 * rides — when `enabled === true` and `status !== 'active'`.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { api } from './api';
import { useAuth } from './auth';

export type DriverSubscriptionStatus =
  | 'none'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'trialing'
  | 'incomplete'
  | 'incomplete_expired'
  | (string & {});

export type DriverSubscriptionState = {
  enabled: boolean;
  status: DriverSubscriptionStatus;
  monthlyAmountCents: number;
  nextBillingAt: string | null;
  lastPaidAt: string | null;
  lastFailureReason: string | null;
};

const DEFAULT_STATE: DriverSubscriptionState = {
  enabled: false,
  status: 'none',
  monthlyAmountCents: 0,
  nextBillingAt: null,
  lastPaidAt: null,
  lastFailureReason: null,
};

type Ctx = {
  loading: boolean;
  state: DriverSubscriptionState;
  /** True when subscription is required and the driver has not paid yet. */
  needsPayment: boolean;
  /** Re-read /api/driver/subscription from the backend. */
  refresh: () => Promise<void>;
  /**
   * Ask the backend for a Stripe Checkout URL and open it. Resolves once the
   * browser session is closed, then re-fetches the subscription state so any
   * successful payment is picked up on the next render.
   */
  startCheckout: () => Promise<{ ok: boolean; error?: string }>;
};

const DriverSubscriptionCtx = createContext<Ctx | null>(null);

/**
 * Try a series of plausible backend paths for creating a Stripe Checkout
 * session. The first one that returns HTTP 2xx wins. Servers can add /
 * rename their endpoint without a frontend redeploy as long as the name is
 * still in this list.
 */
const CHECKOUT_ENDPOINT_CANDIDATES = [
  '/driver/subscription/checkout',
  '/driver/subscription/checkout-session',
  '/driver/subscription/create-checkout-session',
  '/driver/subscription/pay',
  '/driver/subscription/subscribe',
  '/driver/subscription/start',
  '/driver/subscription/session',
  '/driver/subscription',
];

function readServerState(raw: any): DriverSubscriptionState {
  if (!raw || typeof raw !== 'object') return DEFAULT_STATE;
  return {
    enabled: Boolean(raw.enabled),
    status: (raw.status ?? 'none') as DriverSubscriptionStatus,
    monthlyAmountCents: Number(raw.monthly_amount_cents ?? 0) || 0,
    nextBillingAt: raw.next_billing_at ?? null,
    lastPaidAt: raw.last_paid_at ?? null,
    lastFailureReason: raw.last_failure_reason ?? null,
  };
}

/**
 * Helper used by non-hook code (e.g. RideRequestModal fallbacks) — pure
 * business rule so we don't scatter the definition of "must pay" logic.
 */
export function subscriptionNeedsPayment(s: DriverSubscriptionState): boolean {
  return !!s.enabled && s.status !== 'active';
}

export function DriverSubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user, isPro } = useAuth();
  const [state, setState] = useState<DriverSubscriptionState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const isDriver = !!user && !isPro && user.role === 'driver';

  const refresh = useCallback(async () => {
    if (!isDriver) {
      setState(DEFAULT_STATE);
      return;
    }
    if (inFlightRef.current) return inFlightRef.current;
    const p = (async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/driver/subscription');
        setState(readServerState(data));
      } catch {
        // Silent — keep the previous state so a transient network error
        // doesn't wrongly unblock the driver.
      } finally {
        setLoading(false);
      }
    })();
    inFlightRef.current = p;
    try { await p; } finally { inFlightRef.current = null; }
  }, [isDriver]);

  // Initial + on-login load
  useEffect(() => {
    if (isDriver) void refresh();
    else setState(DEFAULT_STATE);
  }, [isDriver, refresh]);

  // Refresh whenever the app returns to foreground — matches the moment
  // the driver comes back from Stripe Checkout.
  useEffect(() => {
    if (!isDriver) return;
    const onChange = (s: AppStateStatus) => { if (s === 'active') void refresh(); };
    const sub = AppState.addEventListener('change', onChange);
    return () => { try { sub.remove(); } catch {} };
  }, [isDriver, refresh]);

  // Light polling every 60s while the driver is blocked, so a successful
  // webhook-updated payment unlocks the UI without user interaction.
  useEffect(() => {
    if (!isDriver) return;
    if (!subscriptionNeedsPayment(state)) return;
    const id = setInterval(() => { void refresh(); }, 60_000);
    return () => clearInterval(id);
  }, [isDriver, state, refresh]);

  const startCheckout = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    // Try each candidate endpoint until one returns a checkout URL.
    let lastErr = '';
    for (const path of CHECKOUT_ENDPOINT_CANDIDATES) {
      try {
        const { data } = await api.post(path, {});
        const url: string | undefined =
          data?.url || data?.checkout_url || data?.session_url || data?.stripe_url;
        if (url && typeof url === 'string') {
          try {
            if (Platform.OS === 'web') {
              // On web preview, open in a new tab so we don't lose the app.
              window.open(url, '_blank');
            } else {
              await WebBrowser.openBrowserAsync(url);
            }
          } catch (e: any) {
            return { ok: false, error: e?.message || 'Impossible d\u2019ouvrir le navigateur' };
          }
          // Refresh once the browser session is dismissed
          void refresh();
          return { ok: true };
        }
        lastErr = 'Réponse du backend sans URL de paiement';
      } catch (e: any) {
        // 404/405/other — try the next candidate. Keep the last error for
        // diagnostics if every candidate fails.
        const code = e?.response?.status;
        lastErr = code ? `HTTP ${code}` : (e?.message || 'erreur réseau');
      }
    }
    return {
      ok: false,
      error:
        'Endpoint de paiement non disponible côté serveur. ' +
        'Contactez votre opérateur (' + lastErr + ').',
    };
  }, [refresh]);

  const value: Ctx = {
    loading,
    state,
    needsPayment: subscriptionNeedsPayment(state),
    refresh,
    startCheckout,
  };

  return (
    <DriverSubscriptionCtx.Provider value={value}>
      {children}
    </DriverSubscriptionCtx.Provider>
  );
}

export function useDriverSubscription(): Ctx {
  const c = useContext(DriverSubscriptionCtx);
  if (c) return c;
  // Safe defaults when the hook is called outside the provider (e.g. Pro
  // screens don't wrap themselves in it). This avoids crashing shared
  // components that happen to render in both role trees.
  return {
    loading: false,
    state: DEFAULT_STATE,
    needsPayment: false,
    refresh: async () => {},
    startCheckout: async () => ({ ok: false, error: 'not_in_driver_context' }),
  };
}
