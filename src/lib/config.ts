const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8080'];
const PROD_ORIGINS = ['https://lamata.tec.br'];

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
}

export function parseAllowedOrigins(env: NodeJS.ProcessEnv): string[] {
  const raw = env.ALLOWED_ORIGINS;
  if (raw) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return isProduction(env) ? PROD_ORIGINS : DEV_ORIGINS;
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

export function clampLimit(value: number | undefined, fallback: number, max = 100): number {
  const n = value ?? fallback;
  return Math.min(Math.max(1, n), max);
}