export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) cookies[key] = value;
  }
  return cookies;
}

export function isAuthenticatedUpgrade(cookieHeader: string | undefined, verify: (token: string) => boolean): boolean {
  const token = parseCookies(cookieHeader)['aurasync_token'];
  if (!token) return false;
  try {
    return verify(token);
  } catch {
    return false;
  }
}