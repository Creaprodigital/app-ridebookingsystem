import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { tokenStore, login as apiLogin, getMe, getMapsClientKey } from './api';
import { stopBackgroundLocation } from './backgroundLocation';
import { setActiveMapsKey } from './mapsKey';

type User = { id?: string; email?: string; first_name?: string; last_name?: string; role?: string; tenant_id?: string };
type Tenant = { id?: string; slug?: string; company_name?: string; widget_config?: any; pricing?: any; config?: any } | null;

type AuthCtx = {
  user: User | null;
  tenant: Tenant;
  loading: boolean;
  isPro: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant>(null);
  const [loading, setLoading] = useState(true);

  // Use the professional's own Google Maps key (pro + its linked drivers).
  // Awaited before the user is set so maps are created with the right key.
  const loadTenantMapsKey = useCallback(async (res: any) => {
    const key = (await getMapsClientKey()) || res?.tenant?.config?.google_maps_api_key;
    setActiveMapsKey(key);
  }, []);

  const applyMeResponse = useCallback((res: any) => {
    // /auth/me returns { user, tenant } — login also returns the same shape.
    if (res && (res.user || res.tenant)) {
      setUser(res.user ?? null);
      setTenant(res.tenant ?? null);
      // Maps key is applied by loadTenantMapsKey() before this runs.
    } else {
      // Fallback: response is the user object directly
      setUser(res ?? null);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const token = await tokenStore.get();
      if (!token) {
        setUser(null);
        setTenant(null);
        return;
      }
      const me = await getMe();
      await loadTenantMapsKey(me);
      applyMeResponse(me);
    } catch {
      await tokenStore.clear();
      setUser(null);
      setTenant(null);
    }
  }, [applyMeResponse, loadTenantMapsKey]);

  useEffect(() => {
    (async () => {
      await refresh();
      setLoading(false);
    })();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const res: any = await apiLogin(email, password);
    if (!res.token) throw new Error('Token manquant dans la réponse');
    await tokenStore.set(res.token);
    // login response shape: { token, user, tenant }
    if (res.user || res.tenant) {
      await loadTenantMapsKey(res);
      setUser(res.user ?? null);
      setTenant(res.tenant ?? null);
    } else {
      const me = await getMe();
      await loadTenantMapsKey(me);
      applyMeResponse(me);
    }
  }, [applyMeResponse, loadTenantMapsKey]);

  const signOut = useCallback(async () => {
    // Stop the foreground-service-backed location tracker first so the
    // notification doesn't linger after logout.
    try { await stopBackgroundLocation(); } catch {}
    await tokenStore.clear();
    setUser(null);
    setTenant(null);
    setActiveMapsKey(null);
  }, []);

  const isPro = user?.role === 'pro';

  return (
    <Ctx.Provider value={{ user, tenant, loading, isPro, signIn, signOut, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used within AuthProvider');
  return c;
}
