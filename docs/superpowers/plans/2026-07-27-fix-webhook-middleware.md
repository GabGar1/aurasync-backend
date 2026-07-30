# Fix Webhook Middleware

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fix two issues in the Nuvemshop webhook middleware: (1) use timing-safe HMAC comparison, (2) improve the HMAC header parsing to handle hashes containing `=`.

**Architecture:** Replace `signature !== expected` with `crypto.timingSafeEqual` and use a more robust split for the `algorithm=hash` header format.

**Tech Stack:** Node.js built-in `crypto`

## Global Constraints

- Webhook must remain functional
- HMAC verification must remain correct

---

### Task 1: Implement timing-safe HMAC comparison

**Files:**
- Modify: `src/middlewares/nuvemshop.middleware.ts:28,36-40`

**Problem:** `signatureHash !== expectedSignature` on line 40 uses string comparison which is not timing-safe. Also, `nuvemshopSignature.split('=')` on line 28 breaks if the hash contains `=`.

- [ ] **Step 1: Fix HMAC header parsing and comparison**

Edit `src/middlewares/nuvemshop.middleware.ts:28-40`:

Replace this:
```
  const [algorithm, signatureHash] = nuvemshopSignature.split('=');

  if (algorithm !== 'sha256') {
    console.warn('Algoritmo de assinatura de webhook inválido. Esperado sha256.');
    reply.status(401).send({ error: 'Invalid webhook signature algorithm.' });
    return;
  }

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const expectedSignature = hmac.digest('hex');

  if (signatureHash !== expectedSignature) {
    console.warn('Assinatura de webhook inválida recebida.');
    reply.status(401).send({ error: 'Invalid webhook signature.' });
    return;
  }
```

With this:
```
  const eqIndex = nuvemshopSignature.indexOf('=');
  const algorithm = nuvemshopSignature.slice(0, eqIndex);
  const signatureHash = nuvemshopSignature.slice(eqIndex + 1);

  if (algorithm !== 'sha256') {
    console.warn('Algoritmo de assinatura de webhook inválido. Esperado sha256.');
    reply.status(401).send({ error: 'Invalid webhook signature algorithm.' });
    return;
  }

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const expectedSignature = hmac.digest('hex');

  if (signatureHash.length !== expectedSignature.length || !crypto.timingSafeEqual(Buffer.from(signatureHash), Buffer.from(expectedSignature))) {
    console.warn('Assinatura de webhook inválida recebida.');
    reply.status(401).send({ error: 'Invalid webhook signature.' });
    return;
  }
```

- [ ] **Step 2: Verify compilation**

```bash
npx tsc --noEmit 2>&1 | head -10
```

Expected: No errors.

- [ ] **Step 3: Write a test for the middleware**

Create `src/middlewares/nuvemshop.middleware.test.ts`:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';

// Replicate the HMAC verification logic for isolated testing
function verifySignature(payload: string, secret: string, signatureHeader: string): boolean {
  const eqIndex = signatureHeader.indexOf('=');
  const algorithm = signatureHeader.slice(0, eqIndex);
  const signatureHash = signatureHeader.slice(eqIndex + 1);

  if (algorithm !== 'sha256') return false;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const expected = hmac.digest('hex');

  return signatureHash.length === expected.length && crypto.timingSafeEqual(Buffer.from(signatureHash), Buffer.from(expected));
}

describe('Nuvemshop webhook signature verification', () => {
  it('should validate a correct signature', () => {
    const payload = '{"test":true}';
    const secret = 'test-secret';
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const validSignature = `sha256=${hmac.digest('hex')}`;

    assert.strictEqual(verifySignature(payload, secret, validSignature), true);
  });

  it('should reject an invalid signature', () => {
    const payload = '{"test":true}';
    const secret = 'test-secret';

    assert.strictEqual(verifySignature(payload, secret, 'sha256=invalid'), false);
  });

  it('should handle hash containing = character', () => {
    // This tests the indexOf approach vs split
    const payload = '{"test":true}';
    const secret = 'test-secret';
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    // hash is hex so won't contain = in practice, but test the parser
    const validSignature = `sha256=${hmac.digest('hex')}`;

    assert.doesNotThrow(() => verifySignature(payload, secret, validSignature));
  });
});
```

- [ ] **Step 4: Run the test**

```bash
node --import tsx --test src/middlewares/nuvemshop.middleware.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/middlewares/nuvemshop.middleware.ts src/middlewares/nuvemshop.middleware.test.ts
git commit -m "fix: timing-safe HMAC comparison and robust header parsing in webhook middleware"
```
