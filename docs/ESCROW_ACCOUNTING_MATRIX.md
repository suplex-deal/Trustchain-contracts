# Escrow Accounting Behavior Matrix

This documents how `contracts/escrow_contract/lib.rs` actually computes fees,
driver payouts, and locked-balance bookkeeping across the scenarios that come
up in review and audits. It is grounded directly in the contract code — see
the cited line numbers — not aspirational behavior.

## Core formulas

- **Fee**: `calculate_fee(amount, fee_bps) = amount.saturating_mul(fee_bps) / 10_000`
  (`contracts/escrow_contract/lib.rs:173-175`). Integer division truncates
  toward zero, so fee calculation always rounds **down** in the driver's favor
  (the platform fee is never rounded up beyond its exact bps value).
- **Driver amount**: `driver_amount = record.amount.saturating_sub(platform_fee)`
  (`lib.rs:499`). Driver always receives `amount - fee`, never a raw split that
  could exceed `amount`.
- **Effective fee**: `get_effective_fee_bps(base_fee_bps, sender_volume)` walks
  the configured `VolumeTiers` from highest threshold down and returns the
  first tier the sender's volume qualifies for, applying
  `base_fee_bps.saturating_sub(tier.discount_bps)`; with no qualifying tier (or
  no tiers configured) it returns `base_fee_bps` unchanged (`lib.rs:211-225`).

## Behavior matrix

| Scenario | Fee bps used | Platform fee | Driver amount | Locked-balance effect | Notes / source |
|---|---|---|---|---|---|
| Standard release, no volume tiers configured | `platform_fee_bps` (protocol default) | `amount * fee_bps / 10_000` | `amount - fee` | `TotalLocked[token] -= amount` | `lib.rs:493-499`, `lib.rs:521-528` |
| Release with a qualifying volume tier | `base_fee_bps - tier.discount_bps` (saturating) | lower than standard | higher than standard | same locked-balance decrement | `lib.rs:211-225`; tiers validated strictly ascending by `validate_volume_tiers` (`lib.rs:186-198`) |
| `platform_fee_bps == 0` (admin set fee to zero) | `0` | `0` | `amount` in full | admin transfer step skipped (`if platform_fee > 0`) | `lib.rs:460`, `lib.rs:472` |
| Volume discount larger than base fee | `base_fee_bps.saturating_sub(discount_bps)` floors at `0`, never negative/wraps | `0` | `amount` in full | same | `saturating_sub` on `u32`, `lib.rs:224` |
| `amount` not evenly divisible by `10_000 / fee_bps` | fee bps as configured | truncated down (integer division) | `amount - truncated_fee` (so driver gets the leftover remainder) | same | `lib.rs:174` — division truncation always favors the driver, never the platform |
| Driver preference asset differs from escrow token (cross-asset payout via settlement contract) | fee computed on original token exactly as above | unchanged | computed `driver_amount` is swapped via `execute_settlement_swap` with `min_amount_out = amount * (10_000 - slippage_tolerance_bps) / 10_000` | same locked-balance decrement (locked balance tracks the *held* token, not the payout asset) | `lib.rs:396-421` |
| `driver_amount` computed as `0` (e.g. 100% effective fee) | as configured | full amount | `0` | payout skipped defensively; `escrow_payout_skipped` event emitted instead of a zero transfer | `lib.rs:352-361` |
| Contract balance insufficient to cover `record.amount` at settlement time | n/a | n/a | n/a | `settle_holdback_escrow` panics with `TrustchainError::InsufficientFunds` before any transfer | `lib.rs:481-486` — balance verified before computing/moving funds |
| Sender volume bump after settlement | n/a | n/a | n/a | `SenderVolume` incremented by 1 and its TTL extended on every settlement, so volume-tier eligibility and the entry itself can't silently expire | `lib.rs:515-520` |
| Non-positive payout amount passed to `payout_driver` (defensive case, amount <= 0) | n/a | n/a | `0`, transfer skipped | n/a | `lib.rs:352-361` |

## What is intentionally out of scope here

- Dispute-split payouts (`resolve_dispute_split`) use a different ratio-based
  split, not the single `platform_fee`/`driver_amount` pair above — that path
  deserves its own matrix if/when it's documented.
- Token transfer failures (e.g. a non-standard SEP-41 token with transfer
  hooks) are not modeled here; `validate_token_contract` only checks that the
  token responds to `decimals` (`lib.rs:203-209`), it does not guarantee
  transfer behavior under all token implementations.
