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
import { AppState, AppStateStatus, Platform, Linking } from 'react-native';
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
   * Ask the backend for a Stripe Checkout URL (recurring subscription with
   * saved card — Stripe debits every month automatically) and open it.
   * Resolves once the browser session is closed, then re-fetches the state.
   */
  startCheckout: () => Promise<{ ok: boolean; error?: string }>;
  /**
   * Open the Stripe Customer Portal so the driver can update the saved card,
   * download invoices, or cancel their subscription themselves.
   */
  openPortal: () => Promise<{ ok: boolean; error?: string }>;
  /**
   * Cancel the active subscription immediately via the backend.
   * The card is unlinked and no further debits happen.
   */
  cancel: () => Promise<{ ok: boolean; error?: string }>;
};

const DriverSubscriptionCtx = createContext<Ctx | null>(null);

/**
 * Build the origin URL we send to the backend so Stripe knows where to bring
 * the driver back after Checkout / Portal. On native we use a custom scheme
 * (deep link handled by expo-router); on web we use the current location so
 * the browser tab redirects back to the app preview.
 */
function buildOriginUrl(): string {
  if (Platform.OS === 'web') {
    try {
      // window is defined on web only
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w: any = (globalThis as any).window;
      if (w?.location?.origin) return w.location.origin;
    } catch {}
    return 'https://ride-share-app-171.preview.emergentagent.com';
  }
  // Custom scheme configured in app.json (`scheme: "sharedridedriver"`) —
  // Stripe redirects to sharedridedriver://subscription/{success,cancel}
  // once the flow completes.
  return 'sharedridedriver://subscription';
}

/**
 * Extract a Stripe URL from the many payload shapes servers use in the wild.
 */
function pickUrl(data: any): string | undefined {
  return data?.url || data?.checkout_url || data?.session_url || data?.portal_url || data?.stripe_url;
}

async function openUrl(url: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      // On web preview we open in the same tab so returning back navigates
      // straight into our origin URL (which we redirect to after payment).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).window.open(url, '_blank');
    } catch {}
    return;
  }
  await WebBrowser.openBrowserAsync(url, { dismissButtonStyle: 'close' });
}

/**
 * Endpoints the backend exposes (as of Sept 2026). If any future rename
 * happens, add the new name to the top of these arrays so the frontend
 * keeps working without a redeploy.
 */
const CHECKOUT_ENDPOINTS = [
  '/driver/subscription/checkout',
  '/driver/subscription/checkout-session',
  '/driver/subscription/create-checkout-session',
  '/driver/subscription/subscribe',
];
const PORTAL_ENDPOINTS = [
  '/driver/subscription/portal',
  '/driver/subscription/manage',
  '/driver/subscription/customer-portal',
];
const CANCEL_ENDPOINTS = [
  '/driver/subscription/cancel',
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
    const body = { origin_url: buildOriginUrl() };
    let lastErr = '';
    for (const path of CHECKOUT_ENDPOINTS) {
      try {
        const { data } = await api.post(path, body);
        const url = pickUrl(data);
        if (url) {
          try {
            await openUrl(url);
          } catch (e: any) {
            return { ok: false, error: e?.message || 'Impossible d\u2019ouvrir le navigateur' };
          }
          // The browser is now on Stripe. When the user returns, AppState
          // will re-focus and our foreground listener will call refresh().
          void refresh();
          return { ok: true };
        }
        lastErr = 'Réponse du backend sans URL de paiement';
      } catch (e: any) {
        const code = e?.response?.status;
        const detail = e?.response?.data?.detail;
        lastErr = detail
          ? (typeof detail === 'string' ? detail : JSON.stringify(detail))
          : code ? `HTTP ${code}` : (e?.message || 'erreur réseau');
      }
    }
    return {
      ok: false,
      error: 'Impossible de lancer le paiement (' + lastErr + ').',
    };
  }, [refresh]);

  const openPortal = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    const body = { origin_url: buildOriginUrl() };
    let lastErr = '';
    for (const path of PORTAL_ENDPOINTS) {
      try {
        const { data } = await api.post(path, body);
        const url = pickUrl(data);
        if (url) {
          try {
            await openUrl(url);
          } catch (e: any) {
            return { ok: false, error: e?.message || 'Impossible d\u2019ouvrir le navigateur' };
          }
          void refresh();
          return { ok: true };
        }
        lastErr = 'Réponse du backend sans URL de portail';
      } catch (e: any) {
        const code = e?.response?.status;
        const detail = e?.response?.data?.detail;
        lastErr = detail
          ? (typeof detail === 'string' ? detail : JSON.stringify(detail))
          : code ? `HTTP ${code}` : (e?.message || 'erreur réseau');
      }
    }
    return { ok: false, error: lastErr || 'Portail Stripe indisponible' };
  }, [refresh]);

  const cancel = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    let lastErr = '';
    for (const path of CANCEL_ENDPOINTS) {
      try {
        await api.post(path, {});
        void refresh();
        return { ok: true };
      } catch (e: any) {
        const code = e?.response?.status;
        const detail = e?.response?.data?.detail;
        lastErr = detail
          ? (typeof detail === 'string' ? detail : JSON.stringify(detail))
          : code ? `HTTP ${code}` : (e?.message || 'erreur réseau');
      }
    }
    return { ok: false, error: lastErr || 'Résiliation indisponible' };
  }, [refresh]);

  // Deep-link handler: Stripe returns the driver to ridebooking://subscription
  // after Checkout / Portal. When that fires we refresh so the new status is
  // reflected instantly instead of waiting for the 60s polling tick.
  useEffect(() => {
    if (!isDriver) return;
    const onUrl = (evt: { url: string }) => {
      if (evt?.url && evt.url.toLowerCase().includes('subscription')) {
        void refresh();
      }
    };
    const sub = Linking.addEventListener('url', onUrl);
    return () => { try { sub.remove(); } catch {} };
  }, [isDriver, refresh]);

  const value: Ctx = {
    loading,
    state,
    needsPayment: subscriptionNeedsPayment(state),
    refresh,
    startCheckout,
    openPortal,
    cancel,
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
    openPortal: async () => ({ ok: false, error: 'not_in_driver_context' }),
    cancel: async () => ({ ok: false, error: 'not_in_driver_context' }),
  };
}
