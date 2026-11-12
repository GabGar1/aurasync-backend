const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8080'];

const DEFAULT_RATE_LIMIT_MAX = 300;
const DEFAULT_RATE_LIMIT_WINDOW = '1 minute';

export function isProduction(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production';
}

export function assertSecureConfig(env: NodeJS.ProcessEnv): void {
  if (!isProduction(env)) return;
  for (const [key, message] of [['JWT_SECRET', 'JWT_SECRET is required in production'], ['CSRF_SECRET', 'CSRF_SECRET is required in production']] as const) {
    const value = env[key];
    if (!value || value.startsWith('change-me') || value.startsWith('dev-')) {
      throw new Error(message);
    }
  }
  if (parseAllowedOrigins(env).length === 0) {
    throw new Error('ALLOWED_ORIGINS is required in production');
  }
}

export function parseAllowedOrigins(env: NodeJS.ProcessEnv): string[] {
  const raw = env.ALLOWED_ORIGINS;
  if (raw) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return isProduction(env) ? [] : DEV_ORIGINS;
}

export function resolveHost(env: NodeJS.ProcessEnv): string {
  return env.HOST || '0.0.0.0';
}

export function resolveTrustProxy(env: NodeJS.ProcessEnv): boolean {
  return env.TRUST_PROXY === 'true';
}

export function shouldExposeDocs(env: NodeJS.ProcessEnv): boolean {
  return !isProduction(env);
}

/** Global API rate limit. Sensitive routes (login) set stricter limits per route. */
export function resolveRateLimit(env: NodeJS.ProcessEnv): { max: number; timeWindow: string } {
  const max = Number.parseInt(env.RATE_LIMIT_MAX ?? '', 10);
  return {
    max: Number.isFinite(max) && max > 0 ? max : DEFAULT_RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW || DEFAULT_RATE_LIMIT_WINDOW,
  };
}

export function clampLimit(value: number | undefined, fallback: number, max = 100): number {
  const n = value ?? fallback;
  return Math.min(Math.max(1, Math.floor(n)), max);
}

export function clampPage(value: number | undefined): number {
  const n = Math.floor(value ?? 1);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
