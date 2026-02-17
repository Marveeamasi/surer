# Surer — Escrow Protection for Nigerian Commerce

**Surer** is a production-ready escrow payment platform built for the Nigerian market. It protects both buyers (senders) and sellers (receivers) by holding funds in a secure Payscrow escrow vault until both parties agree on the outcome — or an admin makes a final call.

---

## How It Works

### The 5 Receipt Statuses

| Status | Meaning |
|---|---|
| **Pending** | Receipt created, sender hasn't paid yet |
| **Active** | Payment confirmed, funds held in Payscrow escrow |
| **Dispute** | Parties disagree — 4-day window to negotiate |
| **Unresolved** | 4 days passed without resolution — admin takes over |
| **Completed** | Final settlement executed via Payscrow |

### Decision Codes

**Sender decisions:**
- `1` — Release Full Payment to receiver
- `2` — Release Specific Amount (partial release + refund)
- `3` — Full Refund to sender

**Receiver decisions:**
- `4` — I Have Delivered
- `5` — Accept (the sender's proposal)
- `6` — Reject (the sender's proposal)

### Decision Flow (Active → Completed)

```
(1 + 4) or (4 + 1) → release_all → COMPLETED
(2 or 3 first)     → receiver sees 5/6 instead of 4
(2/3 + 5)          → release per sender's terms → COMPLETED
(2/3 + 6)          → DISPUTE (4-day clock starts)

Any single decision with no response → auto-executes in 2 days
During dispute: parties can re-decide (5 = agree, 6 = still disagree)
After 4 days unresolved → UNRESOLVED → Admin decides immediately
```

### Fee Structure

| Fee | Amount | Who Pays |
|---|---|---|
| **Surer Protection Fee** | 1.5% (capped at ₦700) | Sender |
| **Payscrow Processing Fee** | 2% + ₦100 (capped at ₦1,000) | Sender |
| **Anti-Spam Fee** | ₦100–₦300 (tiered) | Party making decision 2, 3, or 6 |

### Settlement (How Money Moves)

All settlements happen at the **end** via Payscrow's `/broker/settle` API:

1. **No pre-settlement** at payment time — funds stay fluid in escrow
2. When a final decision is reached, `payscrow-release` builds a **settlements array**:
   - Admin gets 1.5% platform fee → admin's bank account
   - Receiver gets payment (or partial) → receiver's bank account
   - Sender gets refund (if any) → sender's bank account
3. One API call settles everyone simultaneously

---

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend:** Lovable Cloud (Supabase)
- **Payments:** Payscrow (escrow + settlement) + Paystack (anti-spam fees)
- **Email:** Resend (transactional notifications)
- **Auth:** 6-digit PIN (password) + optional WebAuthn biometrics

---

## Architecture

### Edge Functions

| Function | Purpose |
|---|---|
| `payscrow-create-payment` | Initiates Payscrow escrow (NO pre-settlement) |
| `payscrow-webhook` | Receives Payscrow payment confirmation, activates receipt |
| `payscrow-release` | **Master Accountant** — builds settlement array, calls `/broker/settle` |
| `dispute-form-handler` | Creates local dispute record (does NOT call Payscrow dispute API) |
| `paystack-initialize-spam-fee` | Initializes Paystack payment for anti-spam fee |
| `paystack-webhook` | Verifies Paystack signature, records spam fee payment |
| `cron-dispute-check` | Daily: auto-executes 2-day decisions, escalates 4-day disputes |
| `send-notification-email` | Sends styled HTML emails for all events via Resend |
| `check-email` | Checks if email exists for auth flow |
| `reset-pin` | Handles PIN reset via email link |

### Database Tables

| Table | Purpose |
|---|---|
| `profiles` | User bank details, display name, fingerprint setting |
| `receipts` | Core transaction records with decisions and status |
| `disputes` | Local dispute tracking with 4-day expiry |
| `evidence` | Image evidence uploaded during disputes |
| `admin_decisions` | Audit log of admin resolutions |
| `user_roles` | Role-based access (admin/user) |
| `withdrawals` | *(Legacy — not used. Settlement is automatic via Payscrow)* |

### Security

- **PIN verification** required for ALL critical actions (pay, decide, update, delete)
- **RLS policies** on every table — users only see their own data
- **Admin role** stored in separate `user_roles` table (not on profile)
- **Paystack webhook** verifies HMAC-SHA512 signature
- **Edge functions** use `SUPABASE_SERVICE_ROLE_KEY` server-side only

---

## Setup & Deployment

### 1. Required Secrets (Backend)

| Secret | Source |
|---|---|
| `PAYSCROW_BROKER_API_KEY` | [Payscrow Marketplace Dashboard](https://payscrow.net) |
| `PAYSTACK_SECRET_KEY` | [Paystack Dashboard](https://dashboard.paystack.com) |
| `RESEND_API_KEY` | [Resend Dashboard](https://resend.com) |

### 2. Cron Setup

Point an external cron service (Vercel Cron, cron-job.org, etc.) to run **daily**:

```
POST https://qnuyiztwqbzcbuheznnv.supabase.co/functions/v1/cron-dispute-check
Headers:
  Content-Type: application/json
  Authorization: Bearer <SUPABASE_ANON_KEY>
```

This single endpoint handles:
- ✅ Auto-executing decisions after 2 days of no response
- ✅ Escalating disputes to "unresolved" after 4 days

### 3. Webhook URLs

Configure these in your payment provider dashboards:

| Provider | Webhook URL |
|---|---|
| **Payscrow** | `https://qnuyiztwqbzcbuheznnv.supabase.co/functions/v1/payscrow-webhook` |
| **Paystack** | `https://qnuyiztwqbzcbuheznnv.supabase.co/functions/v1/paystack-webhook` |

### 4. Admin Setup

1. Create a user account on Surer
2. Insert admin role in database:
   ```sql
   INSERT INTO user_roles (user_id, role) VALUES ('<admin-user-id>', 'admin');
   ```
3. Log in as admin → Settings icon → Configure platform settlement bank account

### 5. Production Checklist

- [ ] Verify your domain on Resend (replace `onboarding@resend.dev`)
- [ ] Update `APP_URL` in `send-notification-email` to your production domain
- [ ] Configure Payscrow webhook URL in their dashboard
- [ ] Configure Paystack webhook URL in their dashboard
- [ ] Set up daily cron job
- [ ] Set admin bank account in Admin panel
- [ ] Test full flow: create receipt → pay → decide → settle

---

## Key Design Decisions

1. **No pre-settlement:** Money stays fluid in Payscrow escrow until the final decision. This allows fair refunds even if bank details change during disputes.

2. **Local disputes only:** We never call Payscrow's `raise-dispute` API. This keeps the money "In Progress" so our `/broker/settle` command always works. Surer handles all dispute logic internally.

3. **No withdraw function:** Settlement goes directly to bank accounts via Payscrow's settle API. There is no "in-app balance" concept.

4. **Admin fee at the end:** The 1.5% platform fee is settled alongside the main payment in one call. If a full refund happens, the admin takes nothing — ensuring user trust.

---

## License

Proprietary — All rights reserved.
