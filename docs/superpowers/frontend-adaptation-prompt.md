# AuraSync Admin Portal — Adapting to the Backend Security Hardening

The backend (`aurasync-backend`, branch `develop`) went through a security hardening pass. The API rules changed and the portal must adapt. Read this document, check the referenced spots in the source code, and implement the changes below.

## Stack context (both repos agree)

- Frontend: Vite + React 18 + axios + @tanstack/react-query + React Hook Form + Zod.
- Backend: Fastify 5, 100% cookie-based auth (`aurasync_token`, httpOnly, SameSite=Strict, secure in prod). The `token` returned at login **must continue to be ignored** — do not store it in localStorage or send it as a header.
- Dev: frontend on `http://localhost:8080`, API on `http://localhost:3333`. Prod: `https://lamata.tec.br` (SPA and API on the same host).

## 1. What changed in the backend (new rules, with HTTP codes)

| # | Change | Behavior |
|---|--------|----------|
| 1 | **Product reads now require auth** | `GET /api/products`, `GET /api/products/:id`, `GET /api/products/slug/:slug` now return **401** without a valid session. Any role (ADMIN/SUPER_ADMIN/EMPLOYEE) may read. |
| 2 | **Login rejects disabled users** | `POST /api/auth/login` returns `401 "Invalid email or password"` for `status:false` (same message as a wrong password — no user enumeration). |
| 3 | **Rate limit** | Login: **5 req/min per IP** (`429`). Global: **100 req/15min per IP** (`429`). The 429 body comes from `@fastify/rate-limit`: `{ statusCode: 429, error: 'Too Many Requests', message: 'Rate limit exceeded, retry in Xs' }`. |
| 4 | **Helmet headers** | Every response now carries `X-Content-Type-Options: nosniff`, `X-Frame-Options`, etc. **Strict CSP in production** (default-src 'self'). Does not affect the SPA, but blocks inline styles in prod if you inject inline `<style>`. |
| 5 | **WebSocket requires the JWT cookie** | The WS handshake validates the `aurasync_token` cookie and answers **401 "Unauthorized"** on upgrade without it (or without a valid JWT). |
| 6 | **CSRF on logout** | `POST /api/auth/logout` requires the header **`X-CSRF-TOKEN`**, enforced by `csrfProtection()` middleware: the value must be `HMAC-SHA256(cookie aurasync_token, CSRF_SECRET)`. The backend exposes the value at `GET /api/auth/csrf`, which **sets a non-httpOnly cookie `XSRF-TOKEN`** with that HMAC. `GET/HEAD/OPTIONS` and requests without the JWT cookie bypass CSRF. |
| 7 | **SUPER_ADMIN protection** | `PUT /api/users/:id` and `DELETE /api/users/:id` return **403** when the target is SUPER_ADMIN and the caller is not SUPER_ADMIN. Messages: `"Forbidden: cannot modify a SUPER_ADMIN account"` / `"Forbidden: cannot delete a SUPER_ADMIN account"`. |
| 8 | **Minimum password length 8** | `POST /api/users` (register) and `PUT /api/users/:id/password` require passwords **>= 8 chars** (400 `"Password must be at least 8 characters"`). |
| 9 | **Pagination cap** | `limit` above 100 on products/users/inventory is **silently reduced** to 100 (no error). |
| 10 | **Generic 500 errors** | Unhandled errors return `{ error: 'Internal server error' }` — **never `error.message` again**. Do not rely on the text of 500 errors to debug or to display. |
| 11 | **/docs hidden in prod** | `GET /docs` returns 404 in production. |

## 2. Impact on the portal (current state → what to change)

Current state verified in `src/services/api.ts`, `src/hooks/useAuth.ts`, `src/hooks/useWebSocket.ts`, `Login.tsx`, `Users.tsx`, `DataTablePagination.tsx`, `App.tsx`.

1. **[LOW/confirm] Auth on product GETs**
   - Today: no interceptor adds `Authorization`; everything relies on the cookie (`axios.defaults.withCredentials = true`) — **correct**. `GET /api/products*` will already work with a session.
   - Action: make sure the dialogs that load products (`VariantPicker.tsx`, `ProductAssociationsDialog.tsx`, `SubgroupProductsDialog.tsx`) only run authenticated (they already live on protected screens) and that the 401 interceptor (`api.ts:30-32`) covers an expired session while in use (redirecting to `/login` already exists).

2. **[HIGH] WebSocket connects without auth and with the wrong host**
   - Today: `useWebSocket.ts:32` calls `new WebSocket(WS_URL)` without checking the session; `.env` **does not set `VITE_WS_URL`** (a prod build would fall back to `ws://localhost:3333`).
   - Action:
     a. Set `VITE_WS_URL` in `.env`/prod build to `wss://lamata.tec.br` (same host as the API).
     b. Only connect after `GET /api/auth/me` confirms a session; if the handshake fails with 401/immediate `close`, **stop reconnecting** and trigger logout → redirect to `/login`.
     c. Treat a denied handshake `onclose`/`onerror` as session end (not just infinite backoff).

3. **[HIGH] Logout depending on axios automatic CSRF (fragile)**
   - Today: `authApi.logout()` relies on axios sending the `XSRF-TOKEN` cookie as the `X-CSRF-TOKEN` header. If `GET /api/auth/csrf` has not run (e.g., direct page reload), the header is missing and the backend returns **403 "Missing CSRF token"**; `useAuth.ts:47-50` swallows the error and the server cookie is **not cleared** (fake logout — only localStorage is wiped).
   - Action (robust):
     a. Make sure the `refreshAuth`/`AuthInitializer` flow calls `GET /api/auth/csrf` on init (not only at login).
     b. Before `POST /auth/logout`, call `GET /api/auth/csrf` if the `XSRF-TOKEN` cookie is absent, and/or keep the CSRF token in memory and set the header manually: `api.post('/auth/logout', {}, { headers: { 'X-CSRF-TOKEN': csrfToken } })`.
     c. Even if logout fails with `403`, keep clearing local state and redirecting to `/login` (the httpOnly cookie expires in 2h; mitigate by flagging to the user).
     d. Note: the backend reads `x-csrf-token`; header names are case-insensitive, so `X-CSRF-TOKEN` matches. Keep sending this name.

4. **[MEDIUM] Handle 429 (rate limit)**
   - Today: `Login.tsx:47-49` falls into the generic case; other screens show raw `getFriendlyError` "Too Many Requests" (`api.ts:352-366`).
   - Action:
     a. Interceptor (`api.ts:27-38`): handle `status === 429` → PT toast "Muitas tentativas. Tente novamente em instantes." (focused on login).
     b. In `Login.tsx`, disable the button and add a ~60s countdown after a 429 login.

5. **[MEDIUM] Password min 8 + add password-change UI**
   - Today: `CreateUserForm` has `minLength={6}` and placeholder "Mínimo 6 caracteres" (`Users.tsx:358-362`) → a 6-7 char password fails on the backend with a raw English 400. There is no password-change UI.
   - Action:
     a. `minLength={8}` + "Mínimo 8 caracteres" texts.
     b. Add a password-change form (current + new, `PUT /api/users/:id/password`) — the backend already exposes the endpoint; today no screen uses it.

6. **[MEDIUM] SUPER_ADMIN 403 in user management**
   - Today: `isAdmin()` (`utils.ts:8-9`) lets an ADMIN edit/delete any user, including SUPER_ADMIN → the backend responds 403 and the toast shows `getFriendlyError` in English (not mapped).
   - Action:
     a. `Users.tsx`: hide/disable edit/delete when the target is SUPER_ADMIN and the logged-in user is not SUPER_ADMIN (you already have the logged-in user's role available).
     b. `api.ts:335-345`: map the two `Forbidden: cannot ...` messages to Portuguese.
     c. Interceptor: handle 403 on mutations (not only on GET) without redirecting to `/products`.

7. **[LOW] Dashboard for EMPLOYEE**
   - Backend: `/api/dashboard/*` and `/api/users/stats` require ADMIN/SUPER_ADMIN; the `/` route (`App.tsx:42`) is not `adminOnly` → an EMPLOYEE visiting `/` gets 403 on the GET and is redirected to `/products`.
   - Action: mark the Dashboard route as `adminOnly` (and/or show a blocked state instead of relying on the redirect).

8. **[LOW] Translate new generic errors**
   - Action in `getFriendlyError` (`api.ts:335-366`): map `'Internal server error'`, `'Too Many Requests'`, `'Missing CSRF token'`, `'Invalid CSRF token'`, `'Password must be at least 8 characters'`. Plus a fallback: when there is no translation, show a generic PT message instead of raw text, and **never** render `error.response.data` for 500s.

9. **[NONE/verify] Pagination cap 100**
   - The portal uses at most `limit=50` (DataTablePagination `[10,20,50]`, Inventory `50`). No mandatory change; just never send `limit>100` later.

## 3. Suggested implementation order (small, tested commits)

1. Interceptor: handle 429, 403-on-mutations, and `getFriendlyError` with new translations + PT fallback.
2. Robust CSRF on logout (call `/auth/csrf` on init and set the header manually on logout; keep the local-logout fallback).
3. WebSocket: correct `VITE_WS_URL`, connect only with a session, stop retry and logout on denied handshake.
4. `Users.tsx`: min 8 + texts; restrict SUPER_ADMIN edit/delete by role; new password-change UI.
5. `App.tsx`: Dashboard `adminOnly`.
6. Final verification (below).

## 4. What NOT to change / pitfalls

- **Do not** start using `Authorization: Bearer` with the login `token` — the backend expects the cookie (`withCredentials`); the JWT header only works where `fastify.authenticate` reads the JWT anyway, but the cookie-based flow is what persists the session.
- **Do not** trust `error.message` from 500s.
- Map `X-CSRF-TOKEN` (hyphen) — the backend reads `x-csrf-token`.
- `OPTIONS`/preflight still passes (204) with CSRF active (CSRF only applies to protected routes after a body exists).
- In prod the cookie is `secure` and `SameSite=Strict`: the SPA and API **must** live on the same host (`lamata.tec.br`) — otherwise the session cookie and WS handshake fail.

## 5. Verification

- `npm test` (Vitest) green in the portal.
- Manual in dev (`:8080` → `:3333`):
  - `GET /logout` without `/auth/csrf` first → must still log out locally / not become a zombie session.
  - 6th wrong login within 1min → 429 with PT feedback.
  - ADMIN tries to edit/delete a SUPER_ADMIN → action hidden (or 403 with PT toast).
  - Login with a 6-7 char password → blocked by the form before submitting.
  - WS: disconnect/reconnect; and with an expired session → redirect `/login`, no reconnect loop.
  - Product reads without a session → redirect `/login` (401 from the interceptor).
- In prod after deploy: `wss://lamata.tec.br` connects; `/docs` is 404; security headers present (`curl -I`).