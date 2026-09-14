import { supabase } from "./supabase";

export const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

/**
 * fetch() wrapper for backend calls: attaches the current Supabase session's
 * access token as `Authorization: Bearer …` so the backend can verify who is
 * calling. Everything else (method, body, headers) behaves exactly like fetch.
 */
export async function apiFetch(url, options = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  const headers = new Headers(options.headers || {});
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}
