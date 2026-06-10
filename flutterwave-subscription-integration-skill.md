# Flutterwave Subscription Integration Skill

Load this skill for any task that touches Flutterwave subscriptions: creating subscription checkout sessions, verifying subscription payments, handling subscription webhooks, managing renewals, upgrading users to Premium, or debugging payment flows.

Do not write Flutterwave subscription code from memory. Flutterwave's APIs evolve, and this skill is the source of truth for how MedQuire handles Premium subscriptions.

---

# What Flutterwave Does for MedQuire

Flutterwave is MedQuire's payment gateway for Premium subscriptions.

Flutterwave performs four core responsibilities:

1. **Hosts the checkout page**
   - Users are redirected to Flutterwave's secure checkout.
   - MedQuire never collects card details directly.

2. **Processes subscription payments**
   - Flutterwave charges cards and handles payment authorization.

3. **Manages recurring billing**
   - Flutterwave automatically bills users according to their subscription plan.

4. **Notifies MedQuire through webhooks**
   - Webhooks are the source of truth for successful payments, renewals, cancellations, and failed charges.

---

# Premium Subscription Plans

At launch MedQuire supports:

```text
FREE
PREMIUM_MONTHLY
PREMIUM_YEARLY
```

Premium unlocks:

- Unlimited AI conversations
- Advanced medication insights
- Unlimited cabinet storage
- Premium interaction analysis
- Future premium features

The exact benefits may evolve over time.

---

# Subscription Flow End-to-End

```text
User clicks "Upgrade to Premium"
        |
        v
POST /api/subscriptions/create
        |
        v
Server creates pending Subscription record
        |
        v
Server calls Flutterwave subscription endpoint
        |
        v
Server receives hosted checkout link
        |
        v
Server returns checkout URL
        |
        v
App redirects user to Flutterwave checkout
        |
        v
User completes payment
        |
        v
Flutterwave redirects user back to app
        |
        v
Flutterwave sends webhook
        |
        v
Webhook verifies transaction
        |
        v
Subscription marked ACTIVE
        |
        v
Premium access granted
```

Important:

```text
Redirect ≠ payment confirmation
Webhook = payment confirmation
```

Never activate Premium based solely on a redirect.

---

# Environment Variables

Flutterwave requires:

```env
FLUTTERWAVE_PUBLIC_KEY=
FLUTTERWAVE_SECRET_KEY=
FLUTTERWAVE_SECRET_HASH=
```

Definitions:

```text
PUBLIC_KEY
Safe for frontend usage.

SECRET_KEY
Server-only.
Used for API calls.

SECRET_HASH
Server-only.
Used for webhook verification.
```

Never expose:

```text
FLUTTERWAVE_SECRET_KEY
FLUTTERWAVE_SECRET_HASH
```

inside React Native code.

They belong only in Railway.

---

# Database Models

## Subscription

```ts
Subscription {
  id
  userId

  plan
  status

  flutterwaveCustomerId
  flutterwaveSubscriptionId

  currentPeriodStart
  currentPeriodEnd

  createdAt
  updatedAt
}
```

---

## Payment

```ts
Payment {
  id

  userId
  subscriptionId

  amount
  currency

  gateway
  gatewayReference

  status

  createdAt
}
```

---

# Subscription Statuses

```text
PENDING
ACTIVE
PAST_DUE
CANCELLED
EXPIRED
```

---

# Creating a Subscription Checkout

Endpoint:

```text
POST /api/subscriptions/create
```

Workflow:

1. Authenticate user
2. Create pending Subscription
3. Generate unique tx_ref
4. Call Flutterwave
5. Return hosted checkout URL

Example payload:

```json
{
  "tx_ref": "medquire_sub_12345",
  "amount": 9.99,
  "currency": "USD",
  "redirect_url": "https://medquire.app/payment-success",
  "customer": {
    "email": "user@example.com",
    "name": "John Doe"
  },
  "customizations": {
    "title": "MedQuire Premium",
    "description": "Monthly Premium Subscription"
  },
  "meta": {
    "user_id": "123",
    "plan": "PREMIUM_MONTHLY"
  }
}
```

Header:

```http
Authorization: Bearer FLUTTERWAVE_SECRET_KEY
```

---

# Webhook Handling

Webhook endpoint:

```text
/api/webhooks/flutterwave
```

This is the source of truth.

Never trust:

```text
redirect URL
frontend state
client success messages
```

Always trust:

```text
verified webhook
```

---

# Webhook Processing

Steps:

1. Verify webhook signature

```http
verif-hash
```

must equal:

```env
FLUTTERWAVE_SECRET_HASH
```

---

2. Parse payload

---

3. Verify transaction

```http
GET /v3/transactions/{id}/verify
```

---

4. Confirm:

```text
status = successful
amount matches
currency matches
tx_ref matches
```

---

5. Activate subscription

```text
PENDING -> ACTIVE
```

---

6. Create Payment record

---

7. Update user access

```text
plan = PREMIUM
```

---

# Renewal Handling

Flutterwave may automatically bill users.

Renewal webhooks should:

```text
Create new Payment record
Update currentPeriodEnd
Keep subscription ACTIVE
```

---

# Failed Renewals

If payment fails:

```text
ACTIVE -> PAST_DUE
```

User may enter a grace period.

Premium access policy is a business decision.

---

# Cancellation Handling

When a user cancels:

```text
ACTIVE -> CANCELLED
```

Do NOT immediately revoke Premium.

Allow access until:

```text
currentPeriodEnd
```

---

# Premium Access Checks

Never trust frontend flags.

Premium access should always be determined by:

```text
Subscription.status
currentPeriodEnd
```

Server-side.

---

# Security Rules

Always:

✅ Verify webhooks

✅ Verify transactions

✅ Store gateway references

✅ Enforce idempotency

---

Never:

❌ Trust redirect URLs

❌ Trust frontend success messages

❌ Trust webhook body without verification

❌ Expose secret keys

---

# Testing

Use Flutterwave test keys.

Test:

1. Successful subscription
2. Failed payment
3. Cancelled payment
4. Duplicate webhook delivery
5. Subscription renewal
6. Subscription cancellation

Verify:

```text
Subscription records
Payment records
Premium access
Webhook processing
```

---

# Common Mistakes

### Activating Premium from frontend

Wrong:

```text
Payment success screen
=> Premium enabled
```

Correct:

```text
Webhook verified
=> Premium enabled
```

---

### Not verifying transactions

Every webhook must be verified.

---

### Missing idempotency

Flutterwave can retry webhooks.

Duplicate events must not create duplicate payments.

---

### Storing premium status only on user table

Premium status must come from:

```text
Subscription
```

not just:

```text
User.plan
```

---

### Exposing secret keys

Flutterwave secret keys must only exist in:

```text
Railway environment variables
```

Never in React Native.

---

# Resources in This Skill

- Subscription checkout creation
- Payment verification
- Webhook verification
- Renewal processing
- Cancellation processing
- Premium entitlement management

This file is the source of truth for all MedQuire Flutterwave subscription implementations.
