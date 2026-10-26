/**
 * Pro (dispatcher) API client.
 *
 * All endpoints live under /pro/* on the shared-ride-pool backend.
 * Public booking creation uses /public/booking (same endpoint as the V1 widget).
 */
import { api } from './api';

// ---------- Types ----------
export type ProDriver = {
  id: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  driver_status?: 'available' | 'busy' | 'offline' | string;
  on_shift?: boolean;
  active?: boolean;
  vehicle_id?: string | null;
  allowed_category_ids?: string[];
  last_location?: {
    lat: number;
    lng: number;
    heading?: number;
    speed?: number;
    updated_at?: string;
  } | null;
};

export type ProBooking = {
  id: string;
  tenant_id: string;
  driver_id?: string | null;
  vehicle_id?: string | null;
  vehicle_type?: string | null;
  trip_type?: string;
  pickup_address: string;
  dropoff_address?: string;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  pickup_at: string;
  /** For `trip_type === 'round_trip'` — ISO string of the return leg. */
  return_at?: string | null;
  schedule_mode?: 'now' | 'later';
  is_immediate?: boolean;
  duration_hours?: number;
  pax?: number;
  bags?: number;
  status?: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'cancelled' | string;
  payment_method?: string;
  payment_status?: string;
  pricing?: any;
  guest_contact?: { first_name?: string; last_name?: string; email?: string; phone?: string };
  notes?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  internal_notes?: string; // dispatcher-only
  /** Optional travel-tracking helpers surfaced in the details sheet. */
  flight_number?: string | null;
  train_number?: string | null;
  tracking_url?: string | null;
  other_info?: string | null;
  created_at?: string;
};

export type ProVehicle = {
  id: string;
  tenant_id: string;
  category_id?: string;
  type?: string;
  brand?: string;
  model?: string;
  plate?: string;
  capacity?: number;
  color?: string;
};

export type ProCategory = {
  id: string;
  label: string;
  description?: string;
  max_seats?: number;
  max_luggage?: number;
  multiplier?: number;
  image_url?: string;
};

export type ProDashboardStats = {
  bookings: number;
  pending: number;
  completed: number;
  today: number;
  drivers: number;
  vehicles: number;
  revenue: number;
};

// ---------- Endpoints ----------
export async function getProDashboard(): Promise<{
  stats: ProDashboardStats;
  recent_bookings: ProBooking[];
}> {
  const { data } = await api.get('/pro/dashboard');
  return data;
}

export async function getProBookings(): Promise<ProBooking[]> {
  const { data } = await api.get('/pro/bookings');
  return Array.isArray(data) ? data : data?.items ?? [];
}

export async function getProDispatch(): Promise<{
  drivers: ProDriver[];
  bookings: ProBooking[];
  vehicles: ProVehicle[];
}> {
  const { data } = await api.get('/pro/dispatch');
  return data;
}

export async function getProDrivers(): Promise<ProDriver[]> {
  const { data } = await api.get('/pro/drivers');
  return Array.isArray(data) ? data : data?.items ?? [];
}

export async function getProVehicles(): Promise<ProVehicle[]> {
  const { data } = await api.get('/pro/vehicles');
  return Array.isArray(data) ? data : data?.items ?? [];
}

export async function getProVehicleCategories(): Promise<ProCategory[]> {
  const { data } = await api.get('/pro/vehicle-categories');
  return Array.isArray(data) ? data : data?.items ?? [];
}

export async function getProWidgetConfig(): Promise<any> {
  const { data } = await api.get('/pro/widget-config');
  return data;
}

/**
 * Fetches the per-tenant Google Maps configuration (API key, region biasing, etc.).
 *
 * Backend contract (proposed):
 *   GET /pro/maps-config
 *   →  { google_maps_api_key: string, country?: string, region?: string }
 *
 * Returns null silently if the endpoint is not yet available so callers can
 * fall back to the global EXPO_PUBLIC_GOOGLE_MAPS_API_KEY.
 */
export type ProMapsConfig = {
  has_key?: boolean;
  key_mask?: string;
  google_maps_api_key?: string;
  country?: string;
  region?: string;
};
export async function getProMapsConfig(): Promise<ProMapsConfig | null> {
  try {
    const { data } = await api.get('/pro/maps-config');
    return data || null;
  } catch {
    return null;
  }
}

/**
 * Server-side Google Places Autocomplete proxy.
 *
 * Backend contract:
 *   GET /api/pro/places/autocomplete?input=X&sessiontoken=Y&country=fr&language=fr
 *   →  { items: [{ label, main, secondary, place_id, lat, lng, source }] }
 *
 * The tenant's Google Maps API key never leaves the backend. The endpoint
 * forwards to Google Places using the tenant's configured key.
 */
export type PlacesPrediction = {
  place_id: string;
  label: string;          // full description (e.g. "Paris, France")
  main?: string;          // primary text (e.g. "Paris")
  secondary?: string;     // secondary text (e.g. "France")
  lat?: number | null;
  lng?: number | null;
  source?: string;
};
export async function proPlacesAutocomplete(
  input: string,
  sessionToken?: string,
  country: string = 'fr',
  language: string = 'fr',
): Promise<{ items: PlacesPrediction[] } | null> {
  try {
    const { data } = await api.get('/pro/places/autocomplete', {
      params: { input, sessiontoken: sessionToken, country, language },
    });
    if (!data) return null;
    // Accept both `items` and `predictions` for forward-compat
    const items = data.items ?? data.predictions ?? [];
    return { items: Array.isArray(items) ? items : [] };
  } catch (e: any) {
    if (e?.response?.status === 404) return null;
    return null;
  }
}

/**
 * Assign a booking to a specific driver.
 */
export async function assignBookingToDriver(bookingId: string, driverId: string) {
  const { data } = await api.post(`/pro/bookings/${bookingId}/assign`, { driver_id: driverId });
  return data;
}

/**
 * Update a booking status (assigned / in_progress / completed / cancelled).
 */
export async function updateProBookingStatus(bookingId: string, status: string) {
  const { data } = await api.patch(`/pro/bookings/${bookingId}/status`, { status });
  return data;
}

/**
 * Get a price quote — same endpoint used by the public V1 widget.
 */
export type QuoteRequest = {
  tenant_id: string;
  pickup_address: string;
  pickup_at: string;
  dropoff_address?: string;
  vehicle_type?: string;
  vehicle_category_id?: string; // field the backend uses to price per category
  trip_type?: string;
  pax?: number;
  bags?: number;
  duration_hours?: number;
};

export async function quoteBooking(body: QuoteRequest): Promise<any> {
  const { data } = await api.post('/public/quote', body);
  return data;
}

/**
 * Create a booking — same endpoint as the V1 widget.
 * Required: tenant_id, pickup_address, pickup_at, contact.
 */
export type CreateBookingRequest = {
  tenant_id: string;
  pickup_address: string;
  pickup_at: string;
  dropoff_address?: string;
  vehicle_type?: string;
  vehicle_category_id?: string;
  trip_type?: string;
  pax?: number;
  bags?: number;
  duration_hours?: number;
  payment_method?: string;
  contact: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
  };
  notes?: string;
  // Dispatcher-only extras
  internal_notes?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  driver_id?: string | null; // for direct manual assignment
};

export async function createBooking(body: CreateBookingRequest): Promise<any> {
  const { data } = await api.post('/public/booking', body);
  return data;
}
