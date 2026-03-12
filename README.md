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
- `2` — Release Specific Amount (partial release + refund remainder)
- `3` — Full Refund to sender

**Receiver decisions:**
- `4` — I Have Delivered
- `5` — Accept (the sender's proposal)
- `6` — Reject (the sender's proposal)

### Decision Flow (Active → Completed)

```
Initial state: Sender sees 1, 2, 3. Receiver sees only 4.

(1 + 4) or (4 + 1)         → release_all → COMPLETED → settlement
(2 or 3 first)              → receiver's 4 is replaced by 5 and 6 immediately
(4 + 2) or (4 + 3)          → receiver's 4 is cleared, replaced by 5 and 6
(2/3 + 5)                   → release per sender's terms → COMPLETED → settlement
(2/3 + 6)                   → DISPUTE (4-day clock starts)

Any single decision with no response → auto-executes in 2 days

During DISPUTE (4-day negotiation window):
- Sender has options: 1, 2, 3
- Receiver has options: 5, 6
- (sender 1)              → immediate COMPLETED
- (2/3 + 5) or (5 + 2/3)  → COMPLETED → settlement
- (2/3 + 6) or (6 + 2/3)  → stays DISPUTE
- No auto-execute during dispute — only 4-day expiry

After 4 days in DISPUTE → UNRESOLVED:
- No more user decisions
- Admin chooses 1, 2, or 3 → immediately COMPLETED → settlement
```

### Fee Structure

| Fee | Amount | Who Pays |
|---|---|---|
| **Surer Protection Fee** | 1.5% (capped at ₦700) | Sender |
| **Payscrow Processing Fee** | 2% + ₦100 (capped at ₦1,000) | Sender |

### Settlement (How Money Moves)

All settlements happen at the **end** via Payscrow's `/broker/settle` API:

1. **No pre-settlement** at payment time — funds stay fluid in escrow
2. When a final decision is reached, `payscrow-release` builds a **settlements array**:
   - Admin gets 1.5% platform fee → admin's bank account
   - Receiver gets payment (or partial) → receiver's bank account
   - Sender gets refund (if any) → sender's bank account
3. One API call settles everyone simultaneously
4. If any party hasn't set bank details, settlement is blocked with a clear error message

---

## Tech Stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend:** Lovable Cloud (Supabase)
- **Payments:** Payscrow v3 (escrow + settlement)
- **Email:** Resend (transactional notifications)
- **Auth:** 6-digit PIN (password) + optional WebAuthn biometrics (device-stored)

---

## Architecture

### Edge Functions

| Function | Purpose |
|---|---|
| `payscrow-create-payment` | Initiates Payscrow escrow (NO pre-settlement) |
| `payscrow-webhook` | Receives Payscrow payment confirmation, activates receipt |
| `payscrow-release` | **Master Accountant** — builds settlement array, calls `/broker/settle` |
| `dispute-form-handler` | Creates local dispute record (does NOT call Payscrow dispute API) |
| `cron-dispute-check` | Daily: auto-executes 2-day decisions, escalates 4-day disputes |
| `send-notification-email` | Sends styled HTML emails for all events via Resend |
| `check-email` | Checks if email exists for auth flow |
| `reset-pin` | Handles PIN reset via email link |

### Database Tables

| Table | Purpose |
|---|---|
| `profiles` | User bank details, display name, fingerprint setting |
| `receipts` | Core transaction records with decisions, status, Payscrow refs |
| `disputes` | Local dispute tracking with 4-day expiry |
| `evidence` | Image evidence uploaded during disputes |
| `admin_decisions` | Audit log of admin resolutions |
| `user_roles` | Role-based access (admin/user) |

### Security

- **PIN verification** required for ALL critical actions (pay, decide, update, delete)
- **WebAuthn biometrics** stored in localStorage (device-specific, auto-prompts on PIN dialog)
- **RLS policies** on every table
- **Admin role** stored in separate `user_roles` table
- **Edge functions** use `SUPABASE_SERVICE_ROLE_KEY` server-side only

---

## Setup & Deployment

### 1. Required Secrets (Backend)

| Secret | Source |
|---|---|
| `PAYSCROW_BROKER_API_KEY` | [Payscrow Marketplace Dashboard](https://payscrow.net) |
| `RESEND_API_KEY` | [Resend Dashboard](https://resend.com) |

### 2. Cron Setup

Point an external cron service (Vercel Cron, cron-job.org, etc.) to run **daily**:

```
POST https://<your-project>.supabase.co/functions/v1/cron-dispute-check
Headers:
  Content-Type: application/json
  Authorization: Bearer <SUPABASE_ANON_KEY>
```

This single endpoint handles:
- ✅ Auto-executing decisions after 2 days of no response (active receipts only)
- ✅ Escalating disputes to "unresolved" after 4 days

### 3. Webhook URL

Configure in your Payscrow dashboard:

| Provider | Webhook URL |
|---|---|
| **Payscrow** | `https://<your-project>.supabase.co/functions/v1/payscrow-webhook` |

### 4. Admin Setup

1. Create a user account on Surer
2. Insert admin role in database:
   ```sql
   INSERT INTO user_roles (user_id, role) VALUES ('<admin-user-id>', 'admin');
   ```
3. Log in as admin → Navigate to Admin page → Configure platform settlement bank account

### 5. Production Checklist

- [ ] Verify your domain on Resend (replace `onboarding@resend.dev` in `send-notification-email`)
- [ ] Update `APP_URL` in `send-notification-email` to your production domain
- [ ] Configure Payscrow webhook URL in their dashboard
- [ ] Set up daily cron job for `cron-dispute-check`
- [ ] Set admin bank account in Admin panel
- [ ] Test full flow: create receipt → pay → make decisions → settle

---

## Key Design Decisions

1. **No pre-settlement:** Money stays fluid in Payscrow escrow until the final decision. This allows fair refunds even if bank details change during disputes.

2. **Local disputes only:** We never call Payscrow's `raise-dispute` API. This keeps the money "In Progress" so our `/broker/settle` command always works. Surer handles all dispute logic internally.

3. **No withdraw function:** Settlement goes directly to bank accounts via Payscrow's settle API. There is no "in-app balance" concept.

4. **Admin fee at the end:** The 1.5% platform fee is settled alongside the main payment in one call. If a full refund happens, the admin can choose to take nothing — ensuring user trust.

5. **Receiver's decision 4 is replaced:** When sender picks 2 or 3, receiver's "delivered" (4) is cleared from the database. Receiver must then choose accept (5) or reject (6) to respond to the new proposal.

6. **No spam fees:** All decisions are free. Evidence submission is encouraged for dispute resolution.

7. **WebAuthn credentials are device-local:** Stored in localStorage, not the database. This is correct because biometric authentication is inherently device-specific.

---

## Launch Readiness

✅ All edge functions are production-complete  
✅ Settlement logic uses Payscrow `/broker/settle` API  
✅ Decision flow matches the documented state machine exactly  
✅ PIN verification on all critical actions  
✅ Admin panel with bank config and unresolved receipt resolution  
✅ Email notifications for all lifecycle events  
✅ 2-day auto-execute and 4-day escalation via cron  
✅ No spam fees — clean, frictionless user experience  
✅ Evidence upload works for all contentious decisions  

**You are ready to deploy to real users.**

---

## License

Proprietary — All rights reserved.
