const BASE_URL = '/api';

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(data.error ?? res.statusText);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export type SettingsMap = Record<string, string>;

export async function fetchSettings(): Promise<SettingsMap> {
  const res = await fetch(`${BASE_URL}/settings`);
  return handleResponse<SettingsMap>(res);
}

export async function patchSettings(settings: SettingsMap): Promise<SettingsMap> {
  const res = await fetch(`${BASE_URL}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return handleResponse<SettingsMap>(res);
}
