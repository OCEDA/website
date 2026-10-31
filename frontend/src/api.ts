// Thin client for the OCEDA backend (see the root README.md, "API" section).
// Uses same-origin "/api" (Vite proxies it to http://localhost:8000 in dev, see vite.config.ts).
// Set VITE_API_URL=http://host:8000 to point somewhere else (backend CORS must allow the origin).

const BASE: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const TOKEN_KEY = "oceda.token";
export const UNAUTH_EVENT = "oceda:unauthorized";

export interface ApiUser { id: number; email: string; name: string }

export interface ApiCapture {
  id: string;
  exam_id: string;
  index: number;
  url: string;
  width: number;
  height: number;
  bytes: number;
  quality: { sharpness: number; brightness: number; score: number };
  created_at: string;
}

export interface ApiResult {
  classification: string; // "Normal" | "Abnormal" (OCEDA_LABELS on the backend)
  confidence: number; // 0-100
  probabilities: Record<string, number>;
  capture_id: string;
  original_url: string;
  heatmap_url: string;
  model: string;
  mock: boolean; // true => no real model loaded, result is simulated
  email: string | null;
  created_at: string;
}

export interface ApiExam {
  id: string;
  status: "open" | "analyzed";
  created_at: string;
  patient: { id: string; name: string; dob: string | null; ear: "Left" | "Right"; notes: string | null };
  capture_count: number;
  selected_capture_id: string | null;
  result: ApiResult | null;
  captures?: ApiCapture[];
  recommended_capture_id?: string | null;
}

export interface DeviceStatus {
  registered: boolean;
  connected: boolean;
  name?: string;
  last_seen?: string | null;
  resolution?: string | null;
  firmware?: string | null;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ── token (localStorage may be unavailable, so never let it throw) ──
export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
function setToken(t: string) {
  try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ }
}
export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

async function request<T>(path: string, init: RequestInit = {}, authed = true): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token && authed) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, headers });
  } catch {
    throw new ApiError(0, "Cannot reach the OCEDA backend");
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* not json */ }
    if (res.status === 401 && token && authed) {
      clearToken();
      window.dispatchEvent(new Event(UNAUTH_EVENT)); // App sends the user back to login
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

/** URL for <img src> / EventSource (they cannot send an Authorization header). */
export function mediaUrl(url: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${BASE}${url}${sep}token=${encodeURIComponent(getToken() ?? "")}`;
}

// ── auth ──
export async function login(email: string, password: string): Promise<ApiUser> {
  const r = await request<{ token: string; user: ApiUser }>(
    "/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, false);
  setToken(r.token);
  return r.user;
}
export async function register(name: string, email: string, password: string): Promise<ApiUser> {
  const r = await request<{ token: string; user: ApiUser }>(
    "/api/auth/register", { method: "POST", body: JSON.stringify({ name, email, password }) }, false);
  setToken(r.token);
  return r.user;
}
export const me = () => request<ApiUser>("/api/auth/me");
export async function logout(): Promise<void> {
  try { await request("/api/auth/logout", { method: "POST" }); } catch { /* already gone */ }
  clearToken();
}

// ── examinations ──
export const createExam = (p: { id: string; name: string; dob: string; ear: "Left" | "Right"; notes: string }) =>
  request<ApiExam>("/api/exams", { method: "POST", body: JSON.stringify({ patient: p }) });
export const listExams = () => request<ApiExam[]>("/api/exams");
export const getExam = (examId: string) => request<ApiExam>(`/api/exams/${examId}`);
export const selectCapture = (examId: string, captureId: string) =>
  request<{ selected_capture_id: string }>(`/api/exams/${examId}/selection`, {
    method: "PUT", body: JSON.stringify({ capture_id: captureId }) });
export const deviceStatus = () => request<DeviceStatus>("/api/device/status");
export const eventsUrl = (examId: string) => mediaUrl(`/api/exams/${examId}/events`);

// React StrictMode runs effects twice in dev; share one in-flight request so we never
// run inference (and send the email) twice for the same capture.
const inflight = new Map<string, Promise<ApiResult>>();
export function analyze(examId: string, captureId: string): Promise<ApiResult> {
  const key = `${examId}:${captureId}`;
  let p = inflight.get(key);
  if (!p) {
    p = request<ApiResult>(`/api/exams/${examId}/analyze`, {
      method: "POST", body: JSON.stringify({ capture_id: captureId }) }).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}
