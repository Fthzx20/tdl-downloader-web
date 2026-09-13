const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export async function getAuthStatus() {
  const res = await fetch(`${API_BASE}/auth/status`);
  if (!res.ok) throw new Error("Failed to check auth status");
  return res.json();
}

export async function getLoginUrl() {
  const res = await fetch(`${API_BASE}/auth/login_url`);
  if (!res.ok) throw new Error("Failed to fetch login URL");
  return res.json();
}

export async function logoutUser() {
  const res = await fetch(`${API_BASE}/auth/logout`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to log out");
  return res.json();
}

export async function exchangeCode(code: string) {
  const res = await fetch(`${API_BASE}/auth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error("Failed to exchange code");
  return res.json();
}

export async function search(query: string, type: string) {
  const res = await fetch(`${API_BASE}/search?query=${encodeURIComponent(query)}&type=${type}`);
  if (!res.ok) {
    if (res.status === 401) throw new Error("NOT_AUTHENTICATED");
    let detail = "Search failed";
    try { const body = await res.json(); detail = body.detail || detail; } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export function getDownloadUrl(type: string, id: string) {
  return `${API_BASE}/download/${type}/${id}`;
}

export async function getSettings() {
  const res = await fetch(`${API_BASE}/settings`);
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

export async function updateSettings(settings: { quality_tier?: string, allow_dolby_atmos?: boolean }) {
  const res = await fetch(`${API_BASE}/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  });
  if (!res.ok) throw new Error("Failed to update settings");
  return res.json();
}

export async function getProgress(taskId: string) {
  const res = await fetch(`${API_BASE}/progress/${taskId}`);
  if (!res.ok) throw new Error("Failed to fetch progress");
  return res.json();
}
