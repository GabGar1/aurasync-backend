import { healthRepository } from '../repositories/health.repository.js';

export interface HealthReport {
  status: 'ok' | 'degraded';
  database: 'ok' | 'unreachable';
  uptime_seconds: number;
}

export class HealthService {
  async check(): Promise<HealthReport> {
    let database: HealthReport['database'] = 'ok';
    try {
      await healthRepository.ping();
    } catch {
      database = 'unreachable';
    }
    return { status: database === 'ok' ? 'ok' : 'degraded', database, uptime_seconds: Math.round(process.uptime()) };
  }
}

export const healthService = new HealthService();
