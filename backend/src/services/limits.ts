import { eq, sql } from 'drizzle-orm';
import db, { sqlite } from '../db';
import { dailyLimits } from '../db/schema';

function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0] as string;
}

export async function getTodayCount(): Promise<number> {
  const today = getTodayDateString();
  const [row] = await db
    .select()
    .from(dailyLimits)
    .where(eq(dailyLimits.date, today));
  return row?.llm_count ?? 0;
}

export async function incrementToday(): Promise<number> {
  const today = getTodayDateString();

  // Use atomic upsert to prevent race conditions
  sqlite.exec(
    `INSERT INTO daily_limits (date, llm_count) VALUES ('${today}', 1)
     ON CONFLICT(date) DO UPDATE SET llm_count = llm_count + 1`,
  );

  const [row] = await db
    .select()
    .from(dailyLimits)
    .where(eq(dailyLimits.date, today));
  return row?.llm_count ?? 1;
}

export async function getRemainingToday(dailyLimit: number): Promise<number> {
  const count = await getTodayCount();
  return Math.max(0, dailyLimit - count);
}

export async function canProcessToday(dailyLimit: number): Promise<boolean> {
  const remaining = await getRemainingToday(dailyLimit);
  return remaining > 0;
}

export async function getLast30DaysUsage(): Promise<Array<{ date: string; count: number }>> {
  const rows = await db.select().from(dailyLimits);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  return rows
    .filter((row) => new Date(row.date) >= thirtyDaysAgo)
    .map((row) => ({ date: row.date, count: row.llm_count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
