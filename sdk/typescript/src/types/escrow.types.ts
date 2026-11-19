/**
 * Type definitions for escrow contract functions
 */

import { EscrowStatus, ProtocolConfig, EscrowRecord } from './common.types';

/**
 * Contract-specific error codes raised by `escrow_contract::EscrowError`.
 * Shared failures use the `ErrorCodes` map in `common.types.ts`.
 */
export const EscrowErrorCodes = {
  InvalidFee: 5,
  InvalidToken: 6,
  InvalidAmount: 7,
  NoPendingSettlementChange: 8,
  InvalidDriver: 10,
  InvalidParties: 11,
  BatchTooLarge: 12,
  InvalidSlippageTolerance: 13,
} as const;

export interface InitParams {
  admin: string;
  token: string;
  platformFeeBps: number;
}

export interface UpdatePlatformFeeParams {
  admin: string;
  newFeeBps: number;
}

export interface VolumeTier {
  volumeThreshold: number;
  discountBps: number;
}

export interface SetVolumeTiersParams {
  admin: string;
  tiers: VolumeTier[];
}

export interface SweepUntrackedBalanceParams {
  admin: string;
  token: string;
  recipient: string;
}

export interface CreateEscrowParams {
  sender: string;
  recipient: string;
  driver: string;
  deliveryId: bigint;
  token: string;
  amount: bigint;
  fleetId?: bigint;
}

export interface CreateEscrowBatchParams {
  sender: string;
  recipient: string;
  token: string;
  escrowList: Array<{
    deliveryId: bigint;
    driver: string;
    amount: bigint;
    fleetId?: bigint;
  }>;
  fleetId?: bigint;
}

export interface ReleaseEscrowParams {
  caller: string;
  deliveryId: bigint;
}

export interface RefundEscrowParams {
  caller: string;
  deliveryId: bigint;
}

export interface RaiseDisputeParams {
  caller: string;
  deliveryId: bigint;
}

export interface ResolveDisputeParams {
  caller: string;
  deliveryId: bigint;
  releaseToDriver: boolean;
}

export interface ResolveDisputeSplitParams {
  caller: string;
  deliveryId: bigint;
  senderShareBps: number;
}

export interface ReleaseHoldbackEscrowParams {
  caller: string;
  deliveryId: bigint;
}

/**
 * Parameters for the permissionless `release_expired_holdback` fallback
 * (Issue #452). No `caller` is required — anyone may submit it once the
 * holdback window has elapsed.
 */
export interface ReleaseExpiredHoldbackParams {
  deliveryId: bigint;
}

export interface MarkHoldbackEscrowParams {
  caller: string;
  deliveryId: bigint;
}

export interface FreezeFundsParams {
  caller: string;
  deliveryId: bigint;
}

export interface ReclaimExpiredEscrowParams {
  deliveryId: bigint;
}

/**
 * Parameters for the admin-only `sweep_untracked_balance` operation
 * (Issue #450).
 */
export interface SweepParams {
  /** Contract admin authorising the sweep. */
  admin: string;
  /** Token whose untracked balance is swept. */
  token: string;
  /** Treasury wallet the untracked balance is transferred to. */
  recipient: string;
}

export interface SetSettlementContractParams {
  admin: string;
  settlementContract: string;
}

/**
 * Mirrors the Rust `PendingSettlementContract` struct returned by
 * `get_pending_settlement_contract`. Present only when a timelock proposal
 * is in-flight; `null` means no change is pending.
 */
export interface PendingSettlementContractInfo {
  /** The proposed new settlement contract address. */
  settlementContract: string;
  /** Unix timestamp (seconds) after which the change may be confirmed. */
  activatesAt: bigint;
}

export interface ConfirmSettlementContractParams {
  admin: string;
}

export interface SetFleetManagementContractParams {
  admin: string;
  fleetContract: string;
}

export interface SetDisputeResolutionContractParams {
  admin: string;
  disputeContract: string;
}

export interface EscrowReleasedEvent {
  deliveryId: bigint;
  driver: string;
  amount: bigint;
  platformFee: bigint;
}

export interface EscrowFundedEvent {
  deliveryId: bigint;
  sender: string;
  token: string;
  amount: bigint;
}

export interface EscrowRefundedEvent {
  deliveryId: bigint;
  sender: string;
  amount: bigint;
}

export interface DeliveryDisputedEvent {
  deliveryId: bigint;
  reporter: string;
  timestamp: number;
}

export interface DisputeResolvedEvent {
  deliveryId: bigint;
  resolver: string;
}

/** Holdback window applied when the admin has never set one (3 days). Mirrors `DEFAULT_HOLDBACK_WINDOW_SECONDS`. */
export const DEFAULT_HOLDBACK_WINDOW_SECONDS = 259_200n;
/** Smallest accepted holdback window (1 day). Mirrors `MIN_HOLDBACK_WINDOW_SECONDS`. */
export const MIN_HOLDBACK_WINDOW_SECONDS = 86_400n;
/** Largest accepted holdback window (365 days). Mirrors `MAX_HOLDBACK_WINDOW_SECONDS`. */
export const MAX_HOLDBACK_WINDOW_SECONDS = 31_536_000n;

export interface SetHoldbackWindowParams {
  /** Must be the stored escrow admin; the call requires its auth. */
  admin: string;
  /** New window in seconds, inclusive range [MIN_HOLDBACK_WINDOW_SECONDS, MAX_HOLDBACK_WINDOW_SECONDS]. */
  windowSeconds: bigint | number;
}

/**
 * On-chain protocol/data version this SDK release targets. Mirrors
 * `PROTOCOL_VERSION` in escrow_contract; compare against
 * `EscrowClient.getProtocolVersion()` to detect an incompatible deployment.
 */
export const SUPPORTED_PROTOCOL_VERSION = 1;
/** Largest accepted slippage tolerance (10%). Mirrors `MAX_SLIPPAGE_TOLERANCE_BPS`. */
export const MAX_SLIPPAGE_TOLERANCE_BPS = 1000;

export interface UpdateSlippageToleranceParams {
  /** Must be the stored escrow admin; the call requires its auth. */
  admin: string;
  /** New tolerance in basis points, integer in the inclusive range [0, MAX_SLIPPAGE_TOLERANCE_BPS]. */
  newSlippageBps: number;
}
