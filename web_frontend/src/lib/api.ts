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

export async function updateSettings(settings: {
  quality_tier?: string;
  allow_dolby_atmos?: boolean;
  r2_enabled?: boolean;
  r2_account_id?: string;
  r2_access_key_id?: string;
  r2_secret_access_key?: string;
  r2_bucket_name?: string;
  r2_public_domain?: string;
}) {
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

export async function getAlbumTracks(albumId: string) {
  const res = await fetch(`${API_BASE}/album/${albumId}/tracks`);
  if (!res.ok) {
    if (res.status === 401) throw new Error("NOT_AUTHENTICATED");
    let detail = "Failed to fetch album tracks";
    try { const body = await res.json(); detail = body.detail || detail; } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export async function getPlaylistTracks(playlistId: string) {
  const res = await fetch(`${API_BASE}/playlist/${playlistId}/tracks`);
  if (!res.ok) {
    if (res.status === 401) throw new Error("NOT_AUTHENTICATED");
    let detail = "Failed to fetch playlist tracks";
    try { const body = await res.json(); detail = body.detail || detail; } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export async function clearServerCache() {
  const res = await fetch(`${API_BASE}/system/clear_cache`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to clear server cache");
  return res.json();
}

export async function getPreviewUrl(trackId: string): Promise<{ status: string; preview_url: string }> {
  const res = await fetch(`${API_BASE}/preview/${trackId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to fetch preview" }));
    throw new Error(err.detail || "Failed to fetch preview URL");
  }
  const data = await res.json();
  let url = data.preview_url;
  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    url = `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
  }
  return { ...data, preview_url: url };
}

export async function resolveBatchLinks(urls: string[]) {
  const res = await fetch(`${API_BASE}/batch/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!res.ok) throw new Error("Failed to resolve batch links");
  return res.json();
}

