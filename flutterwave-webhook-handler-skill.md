# Flutterwave Webhook Handler Skill

Load this skill whenever working on MedQuire's Flutterwave webhook implementation, subscription activation, payment verification, renewal handling, cancellation handling, or debugging webhook-related issues.

Do not write webhook code from memory. Use this skill as the source of truth for MedQuire's subscription payment processing.

---

# Purpose of the Webhook Handler

The webhook handler is the most important part of the subscription billing system.

Flutterwave sends webhooks whenever:

- A subscription payment succeeds
- A subscription payment fails
- A recurring subscription renews
- A subscription is cancelled
- A payment status changes

The webhook is the source of truth.

Never activate Premium access based on:

```text
Frontend success screen
Redirect URL
Client-side payment status
```

Only activate Premium after:

```text
Webhook verification
Transaction verification
Database validation
```

---

# File Location

Webhook handler:

```text
app/api/webhooks/flutterwave/route.ts
```

This file receives incoming webhook events from Flutterwave.

---

# Webhook Responsibilities

The handler must perform the following steps in order:

```text
1. Verify webhook signature
2. Parse payload
3. Verify transaction with Flutterwave
4. Validate subscription data
5. Update subscription state
6. Create payment record
7. Grant Premium access
8. Respond quickly
```

The order must not change.

---

# Webhook Flow

```text
Flutterwave
        |
        v
POST /api/webhooks/flutterwave
        |
        v
Verify Signature
        |
        v
Verify Transaction
        |
        v
Find Subscription
        |
        v
Create Payment Record
        |
        v
Activate Premium
        |
        v
Return 200
```

---

# Security Requirements

The webhook endpoint is public.

Anyone can send requests to it.

Never trust incoming data.

Always verify:

```text
Signature
Transaction ID
Amount
Currency
Subscription
```

before updating the database.

---

# Signature Verification

Flutterwave sends:

```http
verif-hash
```

header.

Compare:

```http
verif-hash
```

against:

```env
FLUTTERWAVE_SECRET_HASH
```

Example:

```ts
signature === FLUTTERWAVE_SECRET_HASH
```

If mismatch:

```text
Reject request
Return 401
Log warning
```

Never continue processing.

---

# Parsing Payload

Expected payload:

```json
{
  "event": "charge.completed",
  "data": {
    "id": 12345,
    "tx_ref": "medquire_sub_123",
    "status": "successful",
    "amount": 9.99,
    "currency": "USD"
  }
}
```

If parsing fails:

```text
Return 400
Log error
```

---

# Required Fields

Must exist:

```text
data.id
data.tx_ref
```

If missing:

```text
Log warning
Return 200
```

Do not retry malformed payloads.

---

# Transaction Verification

Never trust the webhook body.

After signature verification:

Call Flutterwave Verify API.

Endpoint:

```http
GET https://api.flutterwave.com/v3/transactions/{id}/verify
```

Headers:

```http
Authorization: Bearer FLUTTERWAVE_SECRET_KEY
```

---

# Verification Checks

The transaction must satisfy all conditions:

```text
verified.status === success
verified.data.status === successful
```

AND

```text
tx_ref matches
amount matches
currency matches
```

If any check fails:

```text
Log warning
Return 200
Do not activate Premium
```

---

# Subscription Lookup

Use:

```text
tx_ref
```

to locate the subscription.

Example:

```ts
db.subscription.findUnique({
  where: {
    txRef: verified.data.tx_ref
  }
})
```

If subscription does not exist:

```text
Log warning
Return 200
```

Never create subscriptions from webhook data.

---

# Subscription Validation

Cross-check:

```text
Amount
Currency
Plan
Subscription ID
```

against MedQuire records.

Example:

```text
Expected:
Premium Monthly
$9.99 USD

Actual:
Premium Monthly
$9.99 USD
```

Must match exactly.

---

# Payment Persistence

Create Payment record.

Example:

```ts
Payment {
  id
  userId
  subscriptionId
  gatewayReference
  amount
  currency
  status
  paidAt
}
```

Status:

```text
paid
```

---

# Subscription Activation

If verification succeeds:

Update:

```text
Subscription.status
```

from:

```text
PENDING
```

to:

```text
ACTIVE
```

Update:

```text
currentPeriodStart
currentPeriodEnd
```

based on plan.

---

# Premium Access

After activation:

Update user:

```text
FREE -> PREMIUM
```

or derive Premium access directly from Subscription status.

Premium access should always be determined server-side.

---

# Renewal Handling

Renewals are treated similarly to first-time payments.

Workflow:

```text
Receive webhook
Verify transaction
Create payment record
Extend billing period
Keep ACTIVE status
```

---

# Failed Renewals

If payment fails:

```text
ACTIVE -> PAST_DUE
```

Do not immediately delete subscription.

Allow grace-period handling.

---

# Cancellation Handling

Cancellation webhook:

```text
ACTIVE -> CANCELLED
```

User retains Premium access until:

```text
currentPeriodEnd
```

Do not revoke immediately.

---

# Idempotency

Flutterwave retries webhooks.

Duplicate webhooks are normal.

Prevent duplicate processing.

Use:

```text
Payment.gatewayReference
```

as a unique field.

If duplicate:

```text
Return 200
Skip processing
```

---

# Database Transaction Rules

Use a single database transaction for:

```text
Create Payment
Update Subscription
Update User Access
```

This prevents partial updates.

Example:

```text
Payment Created
Subscription Not Updated
```

must never happen.

---

# Error Handling

## Verification Failure

```text
Return 500
Allow retry
```

Reason:

```text
Temporary failure
```

---

## Validation Failure

```text
Return 200
```

Reason:

```text
Manual investigation needed
Retrying will not fix it
```

---

## Duplicate Event

```text
Return 200
```

Reason:

```text
Already processed
```

---

# Logging

Log:

```text
Bad Signature
Parse Failure
Verification Failure
Subscription Not Found
Amount Mismatch
Currency Mismatch
Duplicate Webhook
Successful Activation
Successful Renewal
Cancellation
```

Never log:

```text
Secret Keys
Secret Hashes
Sensitive Customer Data
```

---

# Background Jobs

Never send emails inside webhook processing.

Webhook should remain fast.

Queue jobs:

```text
Send Receipt
Subscription Activated Email
Renewal Confirmation
Cancellation Confirmation
```

after webhook processing.

---

# Testing Checklist

Before release:

### Successful Payment

```text
Subscription Active
Premium Granted
Payment Recorded
```

### Failed Payment

```text
Premium Not Granted
```

### Duplicate Webhook

```text
No Duplicate Payment
```

### Renewal

```text
Billing Period Extended
```

### Cancellation

```text
Subscription Cancelled
Access Maintained Until Expiry
```

---

# Common Mistakes

## Trusting Redirect URL

Wrong:

```text
Payment Success Page
=> Activate Premium
```

Correct:

```text
Verified Webhook
=> Activate Premium
```

---

## Skipping Verification API

Wrong:

```text
Trust Webhook Payload
```

Correct:

```text
Verify Transaction First
```

---

## Missing Idempotency

Wrong:

```text
Every Webhook Creates Payment
```

Correct:

```text
Duplicates Ignored
```

---

## Exposing Secret Keys

Never expose:

```env
FLUTTERWAVE_SECRET_KEY
FLUTTERWAVE_SECRET_HASH
```

Only Railway should access them.

---

# Resources in This Skill

- Flutterwave Transaction Verification
- Subscription Activation Logic
- Subscription Renewal Logic
- Cancellation Handling
- Premium Access Management
- Idempotent Payment Processing

This file is the source of truth for all MedQuire Flutterwave webhook implementations.
