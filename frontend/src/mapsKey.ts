/**
 * Centralised, runtime-mutable Google Maps API key.
 *
 * Why a module-level holder?
 *  - `directions.ts` and similar helpers run outside the React tree, so they
 *    cannot easily reach into the auth context.
 *  - We want every Google Maps call (Directions, Maps SDK on web, place
 *    autocomplete) to use the **tenant's own key** when a Pro account is
 *    logged in, and gracefully fall back to the bundled
 *    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY otherwise.
 *
 * Update the active key by calling `setActiveMapsKey(...)` from the auth
 * provider whenever the logged-in tenant changes. Read it with
 * `getActiveMapsKey()`.
 */

const FALLBACK_KEY = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string) || '';

let activeKey: string = FALLBACK_KEY;

/**
 * Returns the Google Maps API key that should be used for all requests.
 * Prefer the tenant key when one has been registered; otherwise return the
 * bundled fallback key.
 */
export function getActiveMapsKey(): string {
  return activeKey || FALLBACK_KEY;
}

/**
 * Sets the active Google Maps API key. Pass `null`/`undefined`/`''` to
 * revert to the bundled fallback (e.g. on sign-out).
 */
export function setActiveMapsKey(key: string | null | undefined) {
  activeKey = (key && key.trim()) ? key.trim() : FALLBACK_KEY;
}

/**
 * Exposed for diagnostics only — do **not** log this value to telemetry.
 */
export function getFallbackMapsKey(): string {
  return FALLBACK_KEY;
}
