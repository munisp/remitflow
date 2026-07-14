/**
 * api.ts — Centralised API client for React Native RemitFlow app.
 * Uses fetch with credentials and handles tRPC response format.
 */
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://remitflow.app';

export async function apiGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(BASE_URL + path);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return (body?.result?.data ?? body?.result ?? body) as T;
}

export async function apiPost<T>(path: string, data: unknown): Promise<T> {
  const res = await fetch(BASE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'include',
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return (body?.result?.data ?? body?.result ?? body) as T;
}
