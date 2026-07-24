# User Management Authentication & Authorization

Secure user management endpoints following the project's RBAC pattern.

## Routes to change

| Route | Current | New protection |
|---|---|---|
| `POST /users` | public | `onRequest: [app.authenticate]` + `preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]` |
| `PUT /users/:id` | `onRequest: [app.authenticate]` | add `preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]` |
| `PUT /users/:id/password` | `onRequest: [app.authenticate]` | add `preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]` |
| `DELETE /users/:id` | `onRequest: [app.authenticate]` | add `preHandler: [requireRole(['ADMIN', 'SUPER_ADMIN'])]` |
| `GET /users/check-email` | public | add `onRequest: [app.authenticate]` |

`POST /login` stays public. Remaining GET routes already have `app.authenticate`.

## Implementation

**`src/routers/user.router.ts`** — add `app.authenticate` and `requireRole` to the 5 routes above. The router uses `FastifyPluginAsyncZod` but the auth hooks work identically (`.withValidator` returns the same Fastify route builder).

**`src/routers/user.router.test.ts`** — HTTP-level auth tests via `app.inject()`:

| Endpoint | No token | EMPLOYEE | ADMIN |
|---|---|---|---|
| `POST /users` (register) | 401 | 403 | 201 |
| `PUT /users/:id` | 401 | 403 | 200 |
| `PUT /users/:id/password` | 401 | 403 | 200 |
| `DELETE /users/:id` | 401 | 403 | 204 |
| `GET /users/check-email` | 401 | 200 | 200 |
