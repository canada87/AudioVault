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

export interface DailyLimitStatus {
  limit: number;
  used: number;
  remaining: number;
}

export interface Stats {
  records: {
    total: number;
    pending: number;
    transcribed: number;
    done: number;
    error: number;
  };
  llm: {
    dailyLimit: number;
    remaining: number;
    usageLast30Days: Array<{ date: string; count: number }>;
  };
}

export async function fetchLimitsToday(): Promise<DailyLimitStatus> {
  const res = await fetch(`${BASE_URL}/limits/today`);
  return handleResponse<DailyLimitStatus>(res);
}

export async function fetchStats(): Promise<Stats> {
  const res = await fetch(`${BASE_URL}/stats`);
  return handleResponse<Stats>(res);
}
