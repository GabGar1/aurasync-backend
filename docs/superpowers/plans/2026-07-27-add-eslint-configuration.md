# Add ESLint Configuration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add ESLint with TypeScript support to catch code quality issues, unused imports, and common errors. Add `npm run lint` script.

**Architecture:** Standard ESLint flat config with TypeScript parser and recommended rulesets. No stylistic rules — focus on correctness.

**Tech Stack:** ESLint 9+, `typescript-eslint`

## Global Constraints

- Must not introduce false positives on existing patterns (e.g., `console.log` is allowed for now)
- Lint script must be runnable via `npm run lint`
- Follow existing conventions

---

### Task 1: Install ESLint dependencies

- [ ] **Step 1: Install ESLint + TypeScript plugin**

```bash
npm install --save-dev eslint @eslint/js typescript-eslint
```

- [ ] **Step 2: Verify installation**

```bash
npx eslint --version
```

Expected: Prints ESLint version.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add eslint and typescript-eslint dev deps"
```

---

### Task 2: Create ESLint flat config

- [ ] **Step 1: Create `eslint.config.js`**

```javascript
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Allow console.log for now (project uses it extensively)
      'no-console': 'off',
      // Warn on unused vars (auto-fixable with --fix)
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Require explicit return types on functions (can be relaxed later)
      '@typescript-eslint/explicit-function-return-type': 'off',
      // Allow `any` with warning (since codebase has many `as any`)
      '@typescript-eslint/no-explicit-any': 'warn',
      // Catch async functions without await
      'require-await': 'warn',
      // No empty catch blocks
      'no-empty': 'error',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', '*.js'],
  }
);
```

- [ ] **Step 2: Verify config works**

```bash
npx eslint src/
```

Expected: Runs without crashing. May report existing warnings (unused vars, `any` usage).

- [ ] **Step 3: Add lint script to `package.json`**

Edit `package.json:8-15`:
```
  "scripts": {
    "test": "node --import tsx --test --test-concurrency=1 src/**/*.test.ts",
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
+   "lint": "eslint src/",
+   "lint:fix": "eslint src/ --fix",
    "db:make": "node --import tsx ./node_modules/knex/bin/cli.js migrate:make -x ts",
```

- [ ] **Step 4: Run lint to confirm**

```bash
npm run lint
```

Expected: Reports lint issues (warning/error count). No crashes.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js package.json
git commit -m "chore: add ESLint config with TypeScript recommended rules"
```

---

### Task 3: Fix initial lint warnings

- [ ] **Step 1: Run lint with fix**

```bash
npm run lint:fix
```

Expected: Auto-fixable issues (e.g., trailing spaces, formatting) are resolved.

- [ ] **Step 2: Review remaining warnings**

```bash
npm run lint
```

Expected: Remaining warnings are items requiring manual review (unused vars, explicit `any`).

- [ ] **Step 3: Fix or suppress remaining warnings**

For `@typescript-eslint/no-explicit-any` warnings, either:
- Add a TODO comment: `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
- Or fix the type properly (covered in the Zod validation plan)

For `@typescript-eslint/no-unused-vars`, remove unused imports/variables.

- [ ] **Step 4: Run lint one final time**

```bash
npm run lint
```

Expected: Zero errors, zero warnings (or as close as practical).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: fix initial ESLint warnings across the codebase"
```
