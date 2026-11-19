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

/**
 * Parameters for `freeze_funds`. `caller` must be the configured dispute
 * resolution contract; any other address is rejected with `Unauthorized`.
 */
export interface FreezeFundsParams {
  caller: string;
  deliveryId: bigint;
}

/**
 * Parameters for `admin_freeze_funds`, the incident-response freeze.
 */
export interface AdminFreezeFundsParams {
  /** Escrow admin; must sign and match the stored admin. */
  admin: string;
  /** Delivery whose escrow is frozen. */
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

/**
 * Parameters for `set_delivery_contract`: proposes a timelocked rotation of
 * the delivery peer contract. Admin only.
 */
export interface ProposeDeliveryContractParams {
  /** Current escrow admin authorising the proposal. */
  admin: string;
  /** Proposed delivery contract address. */
  deliveryContract: string;
}

/**
 * Mirrors the Rust `PendingPeerContractChange` struct returned by
 * `get_pending_delivery_contract`. `null` means no rotation is pending.
 */
export interface PendingDeliveryContractInfo {
  /** The proposed delivery contract address. */
  deliveryContract: string;
  /** Admin that proposed the change. */
  proposedBy: string;
  /** Unix timestamp (seconds) after which the change may be confirmed. */
  activatesAt: bigint;
}

/** Parameters for `propose_admin` (step 1 of the two-party admin handover). */
export interface ProposeEscrowAdminParams {
  /** Current admin; must sign and match the stored admin. */
  currentAdmin: string;
  /** Address nominated to become admin once it calls `acceptAdmin`. */
  newAdmin: string;
}

/** Parameters for `cancel_admin_proposal`. */
export interface CancelEscrowAdminProposalParams {
  /** Current admin; must sign and match the stored admin. */
  currentAdmin: string;
}

/** Parameters for `accept_admin` (step 2 of the two-party admin handover). */
export interface AcceptEscrowAdminParams {
  /** Nominated admin; must sign and match the pending proposal. */
  newAdmin: string;
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
