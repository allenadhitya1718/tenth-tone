# Creator payouts: admin pages spec

For whoever builds the admin panel (web/admin-v2). Backend: `supabase/migrations/0130_creator_payouts.sql`.
Every RPC below is `SECURITY DEFINER`, refuses with `42501 not permitted` unless `is_admin()`, is granted to
`authenticated` only, and writes `admin_logs` in the same transaction. Call them with the admin's own session
(`supabase.rpc(...)`); no service key in the browser. Money is SAR with 2 decimals; diamonds are integers.

## 1. Payouts overview (dashboard card + page header)

`admin_v2_payout_overview()` → jsonb

| field | meaning |
|---|---|
| `config` | the `payout_config` row (see page 5) |
| `owed_diamonds`, `owed_sar` | withdrawable and not yet paid out (available + in open requests) |
| `on_hold_diamonds` | still inside the 7-day hold |
| `withheld_diamonds` | withheld (refunds, flags, unfunded coins, admin hold) |
| `requested`, `approved` | `{count, sar}` of open withdrawals by status |
| `paid_this_month`, `paid_all_time` | `{count, sar}` |
| `kyc_pending` | KYC submissions waiting (sidebar badge) |
| `creators_on_hold` | creators under an admin hold |
| `top_owed` | `[{user_id, handle, name, owed}]`, 10 largest |

Calling it also releases holds that are due (cheap; safe to call on every load).

## 2. KYC queue

List: `admin_v2_kyc_list(p_status text = 'pending' | 'approved' | 'rejected' | 'all', p_limit int = 50, p_offset int = 0)`
→ rows `{id, user_id, handle, name, account_created_at, legal_name, id_number, id_type ('national_id'|'iqama'),
iban, bank_name, owner_attested, status, reject_reason, submissions, submitted_at, reviewed_at, reviewed_by_handle,
birth_date, same_id_accounts, same_iban_accounts, flagged}`. Oldest first.

Show full IBAN / ID only on the detail view; highlight `same_id_accounts > 0`, `same_iban_accounts > 0`, `flagged`,
and an age under 18 from `birth_date`.

ID photo: `admin_v2_kyc_document(p_kyc_id)` → `{bucket: 'kyc', path, expires_in: 120}` (logged as
`kyc_view_document`). Then, with the admin session:

```js
const { data } = await supabase.storage.from('kyc').createSignedUrl(path, 120);
```

SQL cannot sign URLs; the `kyc admin read` storage policy is what lets an admin session sign it. Never cache the URL
or put it in a shareable link.

Actions: `admin_v2_kyc_review(p_kyc_id, p_approve boolean, p_reason text)`; a reason is required to reject (it is
shown to the creator). Notifies the creator (`payout_kyc_approved` / `payout_kyc_rejected`). An admin cannot review
their own KYC.

Checklist for the reviewer (put it on the page): name on ID = legal name; ID number matches photo; photo is the
front, readable, not expired; IBAN account holder is the same person (call/confirm with the bank if in doubt);
no duplicates.

## 3. Withdrawals

List: `admin_v2_payout_withdrawals(p_status = 'requested' | 'approved' | 'paid' | 'rejected' | 'cancelled' | 'all', p_limit, p_offset)`
→ rows `{id, user_id, handle, name, amount_sar, diamonds, sar_per_diamond, legal_name, iban, bank_name, status,
bank_reference, reject_reason, admin_note, requested_at, approved_at, paid_at, rejected_at, cancelled_at,
creator_available_diamonds, creator_withheld_diamonds, kyc_status, eligibility {eligible, reasons[]}, flagged, on_hold}`.

Tabs: Requested / Approved (to pay) / Paid / Rejected. Warn in red when `creator_available_diamonds < 0` (something
was withheld after the request: a refund came in), `flagged`, `on_hold`, `eligibility.eligible = false`, or
`kyc_status <> 'approved'`.

Actions:
- `admin_v2_payout_approve(p_id, p_note text = null)`: requested → approved. Notifies.
- `admin_v2_payout_mark_paid(p_id, p_reference text)`: approved → paid; the reference (bank transfer id) is required
  and shown to the creator. Only after the transfer has actually been sent. Notifies.
- `admin_v2_payout_reject(p_id, p_reason text)`: requested or approved → rejected; reason required and shown to the
  creator; the diamonds return to their available balance. Notifies.

An admin cannot approve or pay their own withdrawal. Provide a "Copy IBAN" button and a CSV export of the Approved
tab (name, IBAN, bank, amount, withdrawal id) for the bank upload.

## 4. Creator detail (drawer from any row, or from the user page)

`admin_v2_payout_creator(p_user)` → `{balance {total, pending, available, withheld, reserved, withdrawn, ...},
sar_per_diamond, eligibility, hold, kyc, withheld_by_reason {reason: diamonds}, top_senders [{sender_id, handle,
diamonds, gifts, flagged}], recent_earnings [100], withdrawals [50]}`.

Actions:
- `admin_v2_payout_hold(p_user, p_hold boolean, p_reason text)`: hold (reason required) withholds every
  pending/available earning, new gifts arrive withheld, withdrawals refused; release (`p_hold = false`) restores ALL
  withheld rows (including automatic ones) and exempts them from the automatic sender checks.
- `admin_v2_payout_set_earning(p_earning_id, p_action 'withhold' | 'release' | 'reverse', p_reason)`: one gift's
  earnings. Reason required for withhold / reverse. `reverse` is permanent.

`withhold_reason` values: `unfunded_coins` (sender had not paid, in production, for the coins they gave away:
sandbox/test, admin grants, re-gifted coins), `sender_refund` (refund in the lookback window), `sender_flagged`
(unreviewed `wallet_flags` row), `creator_on_hold`, `admin: <text>`.

## 5. Settings

`admin_v2_payout_set_config(p_diamonds_per_coin, p_sar_per_diamond, p_min_withdraw_sar, p_hold_days,
p_min_account_age_days, p_min_age, p_refund_lookback_days, p_active)`; pass only what changes (nulls keep the current
value). Returns the new row; old and new are logged. Read the current row from `payout_config` (select is allowed) or
from the overview. Show the seed rule next to `sar_per_diamond`: cheapest price per coin × 0.70 × 0.50, rounded
down to 4 decimals (0.0102 with the 0104 packages). Notes for the form:
- `sar_per_diamond` changes the value of every diamond not yet requested; open requests keep their own rate.
  Terms promise in-app notice before a change.
- `hold_days` only affects gifts received after the change.
- `active = false` pauses new requests (earning continues).

## 6. Maintenance

`admin_v2_payout_backfill(p_since timestamptz)` creates earnings for gifts that have none (the gift trigger never
blocks a gift; on an unexpected error it logs a warning and skips). Use it after an incident, or once at launch if
the owner decides gifts sent before 0130 should count. Returns `{rows}`.

## Not in the panel (on purpose)

- Tables `creator_kyc`, `creator_withdrawals`, `creator_payout_holds` have no grants for `authenticated`: always use
  the RPCs above.
- No delete for KYC or withdrawals: they are financial records.
