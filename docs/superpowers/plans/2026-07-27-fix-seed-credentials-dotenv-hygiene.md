# Fix Seed Default Credentials & .env Hygiene

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Remove default credentials from seed script so no super admin account is created with known credentials. Add a `.env.example` file documenting required vars without secrets.

**Architecture:** Seed script must fail hard if env vars aren't set. `.env.example` shows the required variables with placeholder values.

**Tech Stack:** Node.js, dotenv

## Global Constraints

- `db:seed` must still work when env vars are properly configured
- No default passwords or secrets in the codebase

---

### Task 1: Fix seed script — require env vars, no fallback defaults

**Files:**
- Modify: `src/db/seed.ts:4-7`

**Problem:** If `DB_SEED_EMAIL` or `DB_SEED_PASSWORD` are not set, the script falls back to `admin@aurasync.com` / `admin123`, creating a super admin with widely known credentials.

- [ ] **Step 1: Read current file**

```bash
cat src/db/seed.ts
```

Expected: Lines 4-7 show fallback defaults.

- [ ] **Step 2: Replace fallback defaults with required env var check**

Edit `src/db/seed.ts:4-7`:

```
- const SUPER_ADMIN_EMAIL = process.env.DB_SEED_EMAIL || "admin@aurasync.com";
- const SUPER_ADMIN_PASSWORD = process.env.DB_SEED_PASSWORD || "admin123";
- const SUPER_ADMIN_FIRST_NAME = process.env.DB_SEED_FIRST_NAME || "Super";
- const SUPER_ADMIN_LAST_NAME = process.env.DB_SEED_LAST_NAME || "Admin";
+ const SUPER_ADMIN_EMAIL = process.env.DB_SEED_EMAIL;
+ const SUPER_ADMIN_PASSWORD = process.env.DB_SEED_PASSWORD;
+ const SUPER_ADMIN_FIRST_NAME = process.env.DB_SEED_FIRST_NAME || "Super";
+ const SUPER_ADMIN_LAST_NAME = process.env.DB_SEED_LAST_NAME || "Admin";
+
+ if (!SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
+   console.error("Seed failed: DB_SEED_EMAIL and DB_SEED_PASSWORD environment variables are required.");
+   process.exit(1);
+ }
```

- [ ] **Step 3: Verify compilation**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: No errors.

- [ ] **Step 4: Verify it fails when env vars are missing (dry run without DB)**

```bash
DB_SEED_EMAIL="" DB_SEED_PASSWORD="" node --import tsx src/db/seed.ts 2>&1 | head -5
```

Expected: Fails with "Seed failed: DB_SEED_EMAIL and DB_SEED_PASSWORD environment variables are required."

- [ ] **Step 5: Commit**

```bash
git add src/db/seed.ts
git commit -m "fix: seed script requires DB_SEED_EMAIL and DB_SEED_PASSWORD env vars, no defaults"
```

---

### Task 2: Create `.env.example` with placeholder values

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Create `.env.example` based on actual .env structure**

Write `.env.example`:
```
PORT=3333
HOST=127.0.0.1
JWT_SECRET=change-me-to-a-random-secret

DATABASE_URL=postgresql://admin:admin@127.0.0.1:5433/aurasync

NUVEMSHOP_STORE_ID=your-store-id
NUVEMSHOP_ACCESS_TOKEN=your-nuvemshop-access-token
NUVEMSHOP_WEBHOOK_SECRET=your-webhook-secret

DB_SEED_EMAIL=admin@aurasync.com
DB_SEED_PASSWORD=change-me-to-a-strong-password

POSTGRES_DB=aurasync
POSTGRES_USER=admin
POSTGRES_PASSWORD=admin
```

- [ ] **Step 2: Check if `.env.example` is in .gitignore**

```bash
grep "env.example" .gitignore
```

If present, remove that line — `.env.example` should be committed.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git status  # verify .env is NOT staged
git commit -m "chore: add .env.example template with placeholder values"
```
