# MedQuire — Flutterwave Subscription Implementation Plan

## Source of Truth

This plan derives entirely from:
- `flutterwave-subscription-integration-skill.md`
- `flutterwave-webhook-handler-skill.md`

Refer to those files for detailed behavioral specifications.

---

## Phase 0 — Environment Variables

### Railway (Server-Side Only)

```env
FLUTTERWAVE_PUBLIC_KEY=   # Safe for frontend usage
FLUTTERWAVE_SECRET_KEY=   # Server only — API calls
FLUTTERWAVE_SECRET_HASH=   # Server only — webhook verification
```

### Frontend (Expo)

```env
EXPO_PUBLIC_FLUTTERWAVE_PUBLIC_KEY=   # Only PUBLIC_KEY, never secrets
```

**Rules:**
- `SECRET_KEY` and `SECRET_HASH` must NEVER exist in React Native code
- Only Railway environment variables hold these values
- The frontend only needs `PUBLIC_KEY` for checkout redirect

---

## Phase 1 — Database Schema Updates

### 1.1 Add `plan` Column to `users` Table

Supabase `users` table (managed by Supabase Auth, use `ALTER TABLE` or a custom `public.users` table):

```sql
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'FREE';
-- Values: FREE | PREMIUM
```

If using a separate `profiles` or `public.users` table:

```sql
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT,
  plan TEXT NOT NULL DEFAULT 'FREE',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 1.2 Create `subscriptions` Table

```sql
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id),

  plan TEXT NOT NULL CHECK (plan IN ('PREMIUM_MONTHLY', 'PREMIUM_YEARLY')),
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED')),

  tx_ref TEXT NOT NULL UNIQUE,

  flutterwave_customer_id TEXT,
  flutterwave_subscription_id TEXT,

  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_tx_ref ON subscriptions(tx_ref);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
```

### 1.3 Create `payments` Table

```sql
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id UUID NOT NULL REFERENCES public.users(id),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id),

  amount NUMERIC(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',

  gateway TEXT NOT NULL DEFAULT 'flutterwave',
  gateway_reference TEXT NOT NULL UNIQUE,  -- idempotency key

  status TEXT NOT NULL CHECK (status IN ('paid', 'failed')),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_subscription_id ON payments(subscription_id);
CREATE INDEX idx_payments_gateway_reference ON payments(gateway_reference);
CREATE INDEX idx_payments_status ON payments(status);
```

### 1.4 Create `process_subscription_payment` RPC Function

Atomic transaction for webhook processing:

```sql
CREATE OR REPLACE FUNCTION process_subscription_payment(
  p_user_id UUID,
  p_subscription_id UUID,
  p_amount NUMERIC,
  p_currency TEXT,
  p_gateway_reference TEXT,
  p_current_period_start TIMESTAMPTZ,
  p_current_period_end TIMESTAMPTZ
) RETURNS void AS $$
BEGIN
  -- Insert payment record
  INSERT INTO payments (user_id, subscription_id, amount, currency, gateway, gateway_reference, status)
  VALUES (p_user_id, p_subscription_id, p_amount, p_currency, 'flutterwave', p_gateway_reference, 'paid');

  -- Update subscription
  UPDATE subscriptions
  SET status = 'ACTIVE',
      current_period_start = p_current_period_start,
      current_period_end = p_current_period_end,
      updated_at = NOW()
  WHERE id = p_subscription_id;

  -- Grant premium access
  UPDATE public.users
  SET plan = 'PREMIUM'
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;
```

Also create a renewal variant that skips `plan` update:

```sql
CREATE OR REPLACE FUNCTION process_subscription_renewal(
  p_subscription_id UUID,
  p_amount NUMERIC,
  p_currency TEXT,
  p_gateway_reference TEXT,
  p_current_period_start TIMESTAMPTZ,
  p_current_period_end TIMESTAMPTZ
) RETURNS void AS $$
BEGIN
  INSERT INTO payments (user_id, subscription_id, amount, currency, gateway, gateway_reference, status)
  SELECT user_id, id, p_amount, p_currency, 'flutterwave', p_gateway_reference, 'paid'
  FROM subscriptions WHERE id = p_subscription_id;

  UPDATE subscriptions
  SET status = 'ACTIVE',
      current_period_start = p_current_period_start,
      current_period_end = p_current_period_end,
      updated_at = NOW()
  WHERE id = p_subscription_id;
END;
$$ LANGUAGE plpgsql;
```

And a grace-period expiry function:

```sql
CREATE OR REPLACE FUNCTION expire_past_due_subscriptions() RETURNS void AS $$
BEGIN
  UPDATE subscriptions
  SET status = 'EXPIRED', updated_at = NOW()
  WHERE status = 'PAST_DUE'
    AND current_period_end < NOW() - INTERVAL '7 days';

  -- Revoke premium for expired subscriptions
  UPDATE public.users
  SET plan = 'FREE'
  WHERE id IN (
    SELECT user_id FROM subscriptions
    WHERE status = 'EXPIRED' AND updated_at > NOW() - INTERVAL '1 minute'
  );
END;
$$ LANGUAGE plpgsql;
```

**Schedule**: Run `expire_past_due_subscriptions()` daily via Supabase cron or a Node.js scheduled job.

---

## Phase 2 — Backend Architecture Updates

### 2.1 New File Structure

```
backend/
├── src/
│   ├── routes/
│   │   ├── search.js            # existing
│   │   ├── autocomplete.js      # existing
│   │   ├── eli12.js             # existing
│   │   ├── interactions.js      # existing
│   │   ├── subscriptions.js     # NEW — create checkout, manage subscriptions
│   │   └── webhooks.js          # NEW — Flutterwave webhook endpoint
│   ├── services/
│   │   ├── openFDA.js           # existing
│   │   ├── deepSeek.js          # existing
│   │   ├── flutterwave.js       # NEW — Flutterwave API client
│   │   └── premium.js           # NEW — premium entitlement checks
│   └── middleware/
│       ├── auth.js              # existing
│       └── premium.js           # NEW — route guard for premium features
├── index.js                     # updated — mount new routes
└── package.json                 # updated — add flutterwave dependency
```

### 2.2 New Dependencies

```json
{
  "axios": "^1.x",
  "crypto": "(built-in, for webhook signature verification)"
}
```

No Flutterwave SDK needed — use raw HTTPS calls via `axios`.

### 2.3 Supabase Migration File

Create `backend/supabase/migrations/003_subscriptions.sql` containing all Phase 1 SQL.

---

## Phase 3 — API Routes

### 3.1 `POST /api/subscriptions/create`

**Purpose**: Initiate a subscription checkout.

**Auth**: Required (authenticated user).

**Request**:
```json
{
  "plan": "PREMIUM_MONTHLY" | "PREMIUM_YEARLY"
}
```

**Workflow**:
1. Validate user is authenticated and not already active on a subscription
2. Check user not already on `PREMIUM` plan
3. Generate `tx_ref` = `medquire_sub_{userId}_{Date.now()}`
4. Create `subscriptions` row with `status = PENDING`
5. Call Flutterwave `POST /v3/subscriptions` with payload (see skill doc §Creating a Subscription Checkout)
6. Return `{ checkout_url: "https://..." }`

**Response**:
```json
{
  "checkout_url": "https://checkout.flutterwave.com/...",
  "subscription_id": "uuid"
}
```

**Error cases**:
- User already has ACTIVE subscription → `409 Conflict`
- Flutterwave call fails → `502 Bad Gateway`, subscription stays `PENDING`
- Validation fails → `400 Bad Request`

### 3.2 `GET /api/subscriptions/current`

**Purpose**: Fetch the current user's subscription status.

**Auth**: Required.

**Response**:
```json
{
  "plan": "FREE" | "PREMIUM_MONTHLY" | "PREMIUM_YEARLY",
  "status": "NONE" | "PENDING" | "ACTIVE" | "PAST_DUE" | "CANCELLED" | "EXPIRED",
  "current_period_end": "ISO string | null"
}
```

If no subscription exists (free user), return `plan: "FREE"`, `status: "NONE"`.

### 3.3 `POST /api/subscriptions/cancel`

**Purpose**: Cancel an active subscription at period end.

**Auth**: Required.

**Workflow**:
1. Find user's active subscription
2. Call Flutterwave to cancel at period end
3. Set `subscription.status = CANCELLED`
4. Do NOT revoke Premium — access continues until `currentPeriodEnd`

**Response**: `{ status: "CANCELLED", access_until: "ISO string" }`

### 3.4 `POST /api/webhooks/flutterwave` (Public)

See Phase 4.

---

## Phase 4 — Webhook Handler

### 4.1 Route Setup

File: `backend/src/routes/webhooks.js`

```js
router.post('/api/webhooks/flutterwave', bodyParser.raw({ type: 'application/json' }), webhookHandler);
```

Use `raw` body parser (not JSON) to preserve signature verification integrity.

### 4.2 Processing Pipeline

Execute in strict order (from webhook-handler skill):

```
1. Verify webhook signature (verif-hash header === FLUTTERWAVE_SECRET_HASH)
2. Parse JSON payload
3. Verify transaction via GET /v3/transactions/{id}/verify
4. Validate: status === successful, amount matches, currency matches, tx_ref matches
5. Lookup subscription by tx_ref
6. Check idempotency (gateway_reference already exists?)
7. Call process_subscription_payment RPC (atomic)
8. Queue background jobs (receipt email, activation email)
9. Return 200
```

### 4.3 Event Type Mapping

| Flutterwave Event | Action |
|---|---|
| `charge.completed` | Activate subscription (first payment) |
| `subscriptization.completed` | Activate subscription |
| `subscription.payment` | Renewal — create Payment, extend period |
| `subscription.failed` | Mark PAST_DUE |
| `subscription.cancelled` | Mark CANCELLED (access until period end) |

### 4.4 Error Responses

| Scenario | HTTP Status | Log |
|---|---|---|
| Bad signature | `401` | `Bad Signature` |
| Parse failure | `400` | `Parse Failure` |
| Verification API failure | `500` | `Verification Failure` |
| Validation mismatch | `200` | `Amount Mismatch` / `Currency Mismatch` |
| Subscription not found | `200` | `Subscription Not Found` |
| Duplicate webhook | `200` | `Duplicate Webhook` |
| Success | `200` | `Successful Activation` / `Successful Renewal` |

---

## Phase 5 — Premium Entitlement Logic

### 5.1 Server-Side Check

Service: `backend/src/services/premium.js`

```js
function isPremium(user) {
  // Derived from Subscription, NOT from User.plan alone
  // User.plan is a cache; Subscription is source of truth
  return user.subscription?.status === 'ACTIVE'
      && user.subscription?.current_period_end > new Date();
}
```

### 5.2 Middleware Guard

File: `backend/src/middleware/premium.js`

```js
// Protect premium-only API routes
router.use('/api/interactions', requirePremium);
router.use('/api/cabinet', requirePremium);
```

### 5.3 Premium Feature Mapping

| Feature | Free | Premium |
|---|---|---|
| Medication search | ✅ | ✅ |
| AI summary | ✅ | ✅ |
| ELI12 toggle | ✅ | ✅ |
| Save to cabinet | ❌ → Auth modal | ✅ |
| View cabinet | ❌ | ✅ |
| Interaction check | ❌ | ✅ |
| Export/share | ❌ | ✅ |
| Unlimited conversations | ❌ | ✅ |

---

## Phase 6 — User Subscription Lifecycle

### State Machine

```
                  ┌─────────────┐
                  │   PENDING   │
                  └──────┬──────┘
                         │ Webhook: payment successful
                         v
                  ┌─────────────┐
           ┌──────│   ACTIVE    │──────┐
           │      └──────┬──────┘      │
           │             │             │
           v             v             v
    ┌───────────┐ ┌───────────┐ ┌───────────┐
    │ PAST_DUE  │ │ CANCELLED │ │  EXPIRED  │
    └─────┬─────┘ └───────────┘ └───────────┘
          │
     ┌────┴────┐
     v         v
  ACTIVE    EXPIRED
  (payment  (grace period
   recovers)  expired)
```

### Key Transitions

| From | To | Trigger | Premium Access |
|---|---|---|---|
| PENDING | ACTIVE | Webhook: payment success | ✅ Granted |
| ACTIVE | PAST_DUE | Webhook: payment failure | ✅ Maintained (7-day grace) |
| PAST_DUE | ACTIVE | Webhook: payment recovered | ✅ Maintained |
| PAST_DUE | EXPIRED | Grace period (7 days) elapsed | ❌ Revoked |
| ACTIVE | CANCELLED | User cancels | ✅ Until period end |
| PAST_DUE | CANCELLED | User cancels during grace | ✅ Until period end |
| ACTIVE | EXPIRED | Period end (no renewal) | ❌ Revoked |

---

## Phase 7 — Frontend Integration

### 7.1 Premium Screen/Modal

- "Upgrade to Premium" CTA in:
  - Empty states of Cabinet
  - Interaction checker (guest users see Auth modal first)
  - Settings screen / profile
- Tapping calls `POST /api/subscriptions/create`
- Opens Flutterwave checkout URL in browser (Linking.openURL or WebBrowser)
- On redirect back, poll `GET /api/subscriptions/current` until status is ACTIVE

### 7.2 Subscription Status Display

- Settings screen shows: plan name, renewal date, cancel button
- If PAST_DUE: show warning badge + "Update payment method" CTA
- If CANCELLED: show "Access until [date]"

### 7.3 Premium Feature Gates

- Cabinet tab: if free user, show EmptyState with upgrade CTA (not blank screen)
- Interaction screen: if free user, show upgrade prompt
- Export/share: if free user, show upgrade CTA

### 7.4 New API Service Methods

```js
// api.js additions
createSubscription(plan)        // POST /api/subscriptions/create
getCurrentSubscription()        // GET /api/subscriptions/current
cancelSubscription()            // POST /api/subscriptions/cancel
isPremium()                     // derived from getCurrentSubscription()
```

---

## Phase 8 — Error Handling Strategy

### 8.1 Flutterwave API Errors

| Error | Action |
|---|---|
| Network timeout | Retry up to 2 times with exponential backoff |
| 4xx from Flutterwave | Log, return `502` with generic message |
| 5xx from Flutterwave | Retry up to 2 times |
| Rate limited | Wait 1s, retry once |

### 8.2 Webhook Errors

| Error | HTTP Response | Retry? |
|---|---|---|
| Signature mismatch | `401` | No |
| Parse failure | `400` | No |
| Verification failure | `500` | Yes (Flutterwave retries) |
| Validation failure | `200` | No (manual investigation) |
| Duplicate event | `200` | No |
| Database failure | `500` | Yes |

### 8.3 Idempotency

- `payments.gateway_reference` has a UNIQUE constraint
- Before inserting, check if `gateway_reference` exists
- If duplicate exists, return `200` immediately — do not reprocess
- This handles Flutterwave webhook retries safely

### 8.4 Graceful Degradation

- If Flutterwave is down, subscription creation returns a clear error
- Premium checks fall back to cached subscription data (stale tolerance: 5 min)
- If webhook fails irrecoverably, log for manual reconciliation

---

## Phase 9 — Testing Strategy

### 9.1 Unit Tests

| Test | What to Verify |
|---|---|
| `premium.isPremium()` | Returns true only when status=ACTIVE AND period not expired |
| `premium.isPremium()` | Returns false for PENDING, PAST_DUE, CANCELLED, EXPIRED |
| `subscriptions.generateTxRef()` | Follows `medquire_sub_{userId}_{timestamp}` format |
| Webhook signature verification | Correctly accepts valid hash, rejects invalid |
| Idempotency check | Returns true for existing gatewayReference |

### 9.2 Integration Tests (with Flutterwave Test Keys)

| Test | Steps |
|---|---|
| Successful subscription | Create checkout → complete payment → verify webhook activates subscription |
| Failed payment | Use invalid card → verify status stays PENDING |
| Duplicate webhook | Send same webhook twice → verify single Payment record |
| Subscription renewal | Simulate renewal webhook → verify new Payment + extended period |
| Cancellation | Cancel subscription → verify CANCELLED + access maintained until period end |

### 9.3 Manual Test Checklist

- [ ] Upgrade flow works end-to-end in staging
- [ ] Premium access granted after webhook (not after redirect)
- [ ] Cabinet accessible only after Premium
- [ ] Interaction checker accessible only after Premium
- [ ] Cancel subscription → Premium still works until period end
- [ ] Failed payment → PAST_DUE shown → Premium still works during grace period
- [ ] Grace period expires → Premium revoked
- [ ] Payment recovered during grace → ACTIVE restored
- [ ] No Premium user can't access restricted features

---

## Phase 10 — Implementation Order

### Step 1: Environment & Schema
- Set Railway environment variables (Phase 0)
- Run database migrations (Phase 1)

### Step 2: Backend Services
- Create `flutterwave.js` API client service
- Create `premium.js` entitlement service
- Create `premium.js` middleware

### Step 3: Subscription API Routes
- Implement `POST /api/subscriptions/create`
- Implement `GET /api/subscriptions/current`
- Implement `POST /api/subscriptions/cancel`
- Mount routes in `index.js`

### Step 4: Webhook Handler
- Implement `POST /api/webhooks/flutterwave` with full pipeline
- Create Supabase RPC functions for atomic processing
- Add idempotency checks
- Add logging

### Step 5: Grace Period Job
- Implement `expire_past_due_subscriptions()` scheduler
- Run daily (Supabase cron or Node.js cron)

### Step 6: Frontend Premium Integration
- Add `createSubscription`, `getCurrentSubscription`, `cancelSubscription` to `api.js`
- Build Premium upgrade screen/flow
- Add premium feature gates to Cabinet, Interaction, Export
- Add subscription status display in Settings

### Step 7: Testing
- Unit tests for premium logic
- Integration tests with Flutterwave test keys
- Manual end-to-end testing

---

## Files to Create (Summary)

| File | Purpose |
|---|---|
| `backend/supabase/migrations/003_subscriptions.sql` | Schema + RPC functions |
| `backend/src/services/flutterwave.js` | Flutterwave API client |
| `backend/src/services/premium.js` | Premium entitlement checks |
| `backend/src/middleware/premium.js` | Premium route guard |
| `backend/src/routes/subscriptions.js` | Subscription CRUD routes |
| `backend/src/routes/webhooks.js` | Flutterwave webhook handler |
| `app/src/services/subscriptions.js` | Frontend subscription API methods |
| `app/src/screens/UpgradeScreen.js` | Premium upgrade UI |
| `app/src/components/SubscriptionBadge.js` | Subscription status badge |

---

## Key Constraints (Non-Negotiable)

1. **Never activate Premium from frontend** — only webhook + transaction verification
2. **Never trust redirect URL** — redirect ≠ payment confirmation
3. **Never expose secret keys** — `FLUTTERWAVE_SECRET_KEY` and `FLUTTERWAVE_SECRET_HASH` on Railway only
4. **Always verify transactions** — every webhook must call `GET /v3/transactions/{id}/verify`
5. **Always enforce idempotency** — `gateway_reference` UNIQUE prevents duplicate payments
6. **Premium derived from Subscription** — `User.plan` is a cache, not source of truth
7. **Webhooks must be fast** — respond `200` immediately, queue async jobs
8. **Atomic database updates** — all state changes in a single transaction via Supabase RPC
