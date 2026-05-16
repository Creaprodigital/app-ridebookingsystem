import { api } from './api';
export type ProClient = {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  total_bookings?: number;
  status?: string;
};
export async function getProClients(): Promise<ProClient[]> {
  const { data } = await api.get('/pro/clients');
  return Array.isArray(data) ? data : data?.items ?? [];
}
