// The API is served from the same address as the website. Set NEXT_PUBLIC_API_URL only to reach
// an API running elsewhere (the UI tests point it at a mock).
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");

export async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${token}`,
      ...init?.headers
    }
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "Yêu cầu chưa thể hoàn tất.");
  return payload as T;
}
