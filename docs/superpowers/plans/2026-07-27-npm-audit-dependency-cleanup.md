# npm Audit Fix & Dependency Cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Resolve all high-severity npm audit warnings and remove unused/legacy dependencies (`express`, `cors`, their `@types/*`).

**Architecture:** `npm audit fix` for automatic fixes, manual removal of dead deps from `package.json`, then `npm install` to sync lockfile.

**Tech Stack:** npm

## Global Constraints

- Follow project conventions from AGENTS.md
- No breaking changes to working code
- Verify the app builds after changes

---

### Task 1: Remove unused dependencies

**Files:**
- Modify: `package.json:26,28,29,39,40`

**Dead deps to remove:**
- `"cors": "^2.8.6"` (Fastify uses `@fastify/cors`)
- `"express": "^5.2.1"` (Fastify is the framework)
- `"@types/cors": "^2.8.19"` (not needed without `cors`)
- `"@types/express": "^5.0.6"` (not needed without `express`)

- [ ] **Step 1: Remove unused deps from `package.json`**

Edit `package.json`:
```
-     "cors": "^2.8.6",
```
```
-     "express": "^5.2.1",
```
```
-     "@types/cors": "^2.8.19",
```
```
-     "@types/express": "^5.0.6",
```

- [ ] **Step 2: Check if anything imports these deps**

```bash
grep -r "from 'express'" src/ --include="*.ts"
grep -r "require('express')" src/ --include="*.ts"
grep -r "from 'cors'" src/ --include="*.ts"
```

Expected: No results (dead deps as documented in AGENTS.md).

- [ ] **Step 3: Run npm install to update lockfile**

```bash
npm install
```

Expected: No errors. Package-lock.json updates.

- [ ] **Step 4: Verify compilation still works**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: Same errors as before (the 5 known TS errors), no new errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove unused express, cors and their @types/* deps"
```

---

### Task 2: Run `npm audit fix`

**Files:**
- Modify: `package-lock.json` (auto-updated)

- [ ] **Step 1: Run audit fix**

```bash
npm audit fix
```

- [ ] **Step 2: Check remaining vulnerabilities**

```bash
npm audit 2>&1 | head -20
```

Expected: Fewer or zero high-severity items. Some may require manual attention (e.g., `@fastify/static` via `@fastify/swagger-ui`).

- [ ] **Step 3: If `@fastify/static` is still flagged (transitive dep)**

The `@fastify/swagger-ui` depends on `@fastify/static`. If no patch is available, check if there's a newer version:

```bash
npm ls @fastify/static
npm outdated @fastify/swagger-ui
```

If available, update:
```bash
npm install @fastify/swagger-ui@latest
```

- [ ] **Step 4: Verify app starts**

```bash
npx tsc --noEmit 2>&1
```

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: npm audit fix - resolve high-severity dependency vulnerabilities"
```
