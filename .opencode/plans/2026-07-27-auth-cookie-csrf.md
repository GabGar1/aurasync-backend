# Auth Infrastructure: HttpOnly Cookie + CSRF Protection

**Goal:** Migrate JWT to HttpOnly cookies, add CSRF via derived tokens (JWT + CSRF_SECRET HMAC).

**Key security improvement over standard double-submit cookie:** CSRF token is DERIVED from the JWT using HMAC-SHA256 + a server-side `CSRF_SECRET`, not random. This means:
- Token changes on every login (new JWT = new CSRF token)
- Token dies when JWT expires (automatic invalidation)
- Server validates statelessly (no session store)
- `GET /auth/csrf` requires authentication (only valid JWT holders get a token)

**Architecture:**
- `@fastify/cookie` for cookie parsing/setting
- `@fastify/jwt` cookie mode reads JWT from `aurasync_token` cookie
- CSRF: derive token = `HMAC-SHA256(JWT, CSRF_SECRET)`; validate header against derived
- `src/routers/auth.router.ts` for auth endpoints
- `src/middlewares/csrf.middleware.ts` for CSRF validation

## Global Constraints

- Existing `POST /login` response `{ token, user }` stays for backward compat
- CSRF skips GET/HEAD/OPTIONS
- `XSRF-TOKEN` cookie is non-HttpOnly (Axios reads it)
- Webhooks exempt from CSRF (HMAC-based)
- Requires `CSRF_SECRET` env var

### Task 1: Install @fastify/cookie

- [ ] `npm install @fastify/cookie`
- [ ] `npx tsc --noEmit`
- [ ] `git add package.json package-lock.json && git commit -m "chore: add @fastify/cookie"`

### Task 2: Update server.ts

- Register `@fastify/cookie`
- Configure JWT with cookie support
- Update CORS (credentials, exact origin)
- Register auth routes

### Task 3: Create CSRF middleware + derivation utility

- Derive CSRF token from JWT: `crypto.createHmac('sha256', CSRF_SECRET).update(jwtToken).digest('hex')`
- Validate `X-CSRF-TOKEN` header against derived value
- Skip GET/HEAD/OPTIONS

### Task 4: Create auth router

- `POST /login` — set HttpOnly cookie + return `{ token, user }`
- `GET /me` — authenticate from cookie/header, return user
- `POST /logout` — clear cookie
- `GET /csrf` — requires auth, derive CSRF from JWT cookie, set non-HttpOnly `XSRF-TOKEN` cookie, return `{ csrfToken }`

### Task 5: Add CSRF hook + cookie to existing login

- Add `csrfProtection()` hook to product, order, inventory, user routers
- Add cookie to existing `/login` for backward compat
- Add `CSRF_SECRET` to `.env.example`
