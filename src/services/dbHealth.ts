import type { DbHealthReport } from '@bindings/DbHealthReport';
import { call } from '@lib/ipc/call';

export async function ensureDbHealthReport(): Promise<DbHealthReport | null> {
  try {
    return await call<DbHealthReport>('db.getHealthReport');
  } catch (error) {
    console.error('Failed to load database health report', error);
    return null;
  }
}

export async function recheckDbHealth(): Promise<DbHealthReport> {
  return await call<DbHealthReport>('db.recheck');
}
