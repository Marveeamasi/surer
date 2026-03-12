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
firstly sender sees 1, 2, 3 and receiver sees just 4
(1 then 4) or (4 then 1) → release_all → COMPLETED → settlement
(2 first or 3 first)     → receiver sees 5 and 6 options to choose from immediatly at his end and 4 is off from ui 
(2 or 3 then 5)          → release per sender's terms → COMPLETED → settlement
(2 or 3 then 6)          → DISPUTE (4-day clock starts) and it continues again , but receiver only has 5 and 6, sender has 1, 2, and 3

Any single decision with no response → auto-executes in 2 days wether 1, 2, 3, 4, 5 and 6 
During dispute: parties can re-decide (1 = Release Full Payment to receiver, 2 = Release Specific Amount (partial release + refund), 3 = Full Refund to sender, 5 = agree, 6 = still disagree for receiver),
After 4 days unresolved → UNRESOLVED → Admin sees in admin page (all eveidence for a receipt), and decides immediately (1, 2, or 3) and it is executed and settlement happens
```

### Fee Structure

| Fee | Amount | Who Pays |
|---|---|---|
| **Surer Protection Fee** | 1.5% (capped at ₦700) | Sender |
| **Payscrow Processing Fee** | 2% + ₦100 (capped at ₦1,000) | Sender |
| **Anti-Spam Fee** removed totally

### Settlement (How Money Moves)

All settlements happen at the **end** via Payscrow's `/broker/settle` API:

1. **No pre-settlement** at payment time — funds stay fluid in escrow
2. When a final decision is reached, `payscrow-release` builds a **settlements array**:
   - Admin gets 1.5% platform fee → admin's bank account if admin hasnt set bank account details? return null, send toast to ensure admin bank details is set bank, "can't process this now, please contact admin"
   - Receiver gets payment (or partial) → receiver's bank account, if receiver hasnt set bank details? return null , send toast to ensure reciever sets bank details "please receiver must add their bank details
   - Sender gets refund (if any) → sender's bank account, if they havent added bank details yet,return null and send toast to to ensure they set , "please sender must add their bank details"
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
| `paystack-initialize-spam-fee` remove
| `paystack-webhook` remove
| `paystack-verify-spam-fee` remove
| `cron-dispute-check` | Daily: auto-executes 2-day decisions, escalates 4-day disputes |
| `send-notification-email` | Sends styled HTML emails for all events via Resend |
| `check-email` | Checks if email exists for auth flow |
| `reset-pin` | Handles PIN reset via email link |

### Database Tables

| Table | Purpose |
|---|---|
| `profiles` | User bank details, display name, fingerprint setting, optional WebAuthn credential |
| `receipts` | Core transaction records with decisions, status and anti‑spam fee tracking |
| `disputes` | Local dispute tracking with 4-day expiry |
| `evidence` | Image evidence uploaded during disputes |
| `admin_decisions` | Audit log of admin resolutions |
| `user_roles` | Role-based access (admin/user) |

### Security

- **PIN verification** required for ALL critical actions (pay, decide, update, delete)
- **RLS policies** on every table — but allows all access for now
- **Admin role** stored in separate `user_roles` table (not on profile)
- **Paystack webhook** verifies HMAC-SHA512 signature
- **Edge functions** use `SUPABASE_SERVICE_ROLE_KEY` server-side only

---

## Setup & Deployment

### 1. Required Secrets (Backend)

| Secret | Source |
|---|---|
| `PAYSCROW_BROKER_API_KEY` | [Payscrow Marketplace Dashboard](https://payscrow.net) |
| `PAYSTACK_SECRET_KEY` not needed
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
| **Paystack** | `https://qnuyiztwqbzcbuheznnv.supabase.co/functions/v1/paystack-webhook` not needed

### 4. Admin Setup

1. Create a user account on Surer
2. Insert admin role in database:
   ```sql
   INSERT INTO user_roles (user_id, role) VALUES ('<admin-user-id>', 'admin');
   ```
3. Log in as admin → Settings icon → Configure platform settlement bank account

### 5. Production Checklist

- [ ] Verify your domain on Resend (replace `onboarding@resend.dev`)
- [ ] Encourage early testers to register fingerprint in settings (WebAuthn) and save before using biometric actions
- [ ] Update `APP_URL` in `send-notification-email` to your production domain
- [ ] Configure Payscrow webhook URL in their dashboard
- [ ] Configure Paystack webhook URL in their dashboard
- [ ] (Optional) configure Paystack webhook / verification on your callback URL to ensure spam‑fee payments are confirmed
- [ ] Set up daily cron job
- [ ] Set admin bank account in Admin panel
- [ ] Test full flow: create receipt → pay → make decisions (including spam‑fee scenarios) → settle

---

## Key Design Decisions

1. **No pre-settlement:** Money stays fluid in Payscrow escrow until the final decision. This allows fair refunds even if bank details change during disputes.

2. **Local disputes only:** We never call Payscrow's `raise-dispute` API. This keeps the money "In Progress" so our `/broker/settle` command always works. Surer handles all dispute logic internally.

3. **No withdraw function:** Settlement goes directly to bank accounts via Payscrow's settle API. There is no "in-app balance" concept.

4. **Admin fee at the end:** The 1.5% platform fee is settled alongside the main payment in one call. If a full refund happens, the admin takes nothing — ensuring user trust.

---

## License

Proprietary — All rights reserved.



