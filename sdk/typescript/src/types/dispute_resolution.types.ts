import { DisputeCase, DisputeStatus } from './common.types';

export interface InitParams {
  admin: string;
  deliveryContract: string;
  escrowContract: string;
  disputeTimeLimit: bigint;
  disputeResolutionLimit: bigint;
}

export interface AddAdminParams {
  caller: string;
  newAdmin: string;
}

export interface AcceptAdminParams {
  newAdmin: string;
}

export interface RemoveAdminParams {
  caller: string;
  oldAdmin: string;
}

export interface SetDisputeDeliveryContractParams {
  caller: string;
  deliveryContract: string;
}

export interface SetDisputeEscrowContractParams {
  caller: string;
  escrowContract: string;
}

/**
 * A proposed peer-contract replacement awaiting confirmation. Mirrors the
 * Rust `PendingPeerContractChange` struct returned by
 * `get_pending_delivery_contract` / `get_pending_escrow_contract`.
 */
export interface PendingPeerContractChange {
  address: string;
  proposedBy: string;
  /** Ledger timestamp (seconds) from which the change may be confirmed. */
  activatesAt: bigint;
}

export interface SetIdentityReputationContractParams {
  caller: string;
  reputationContract: string;
}

export interface SetDisputeReputationPenaltyParams {
  caller: string;
  penalty: number;
}

/**
 * Upper bound (inclusive) the contract accepts for every dispute reputation
 * adjustment: the primary penalty, the pay-driver reward and the split
 * penalty. Mirrors `MAX_DISPUTE_REPUTATION_PENALTY`
 * (`IDENTITY_MAX_REPUTATION / 2`) in `dispute_resolution_contract/lib.rs`, so
 * a single ruling can never move a driver's score by more than half the scale.
 */
export const MAX_DISPUTE_REPUTATION_ADJUSTMENT = 50;

export interface SetDisputeReputationRewardParams {
  caller: string;
  reward: number;
}

export interface SetDisputeSplitPenaltyParams {
  caller: string;
  penalty: number;
}

export interface SetDisputeResolutionLimitParams {
  caller: string;
  newLimit: bigint;
}

export interface UpdateDisputeTimeLimitParams {
  caller: string;
  newLimit: bigint;
}

export interface RaiseDisputeParams {
  caller: string;
  deliveryId: bigint;
}

export interface AddEvidenceHashParams {
  caller: string;
  deliveryId: bigint;
  evidenceHash: string;
}

export interface ResolveDisputeRefundSenderParams {
  caller: string;
  deliveryId: bigint;
}

export interface ResolveDisputeSplitFundsParams {
  caller: string;
  deliveryId: bigint;
  senderShareBps: number;
}

export interface ResolveDisputePayDriverParams {
  caller: string;
  deliveryId: bigint;
}

export interface ForceResolveDisputeParams {
  caller: string;
  deliveryId: bigint;
}

/**
 * The queued outcome of a high-value dispute awaiting a second approval.
 *
 * - `RefundSender`: refund the full escrowed amount to the sender.
 * - `PayDriver`: release the full escrowed amount to the driver.
 * - `SplitFunds`: split the escrowed amount, with `senderShareBps` going to
 *   the sender and the remainder to the driver.
 */
export type ResolutionVerdict =
  | { type: 'RefundSender' }
  | { type: 'PayDriver' }
  | { type: 'SplitFunds'; senderShareBps: number };

/**
 * Read-only view of a pending resolution awaiting a second high-value
 * dispute approval. Exposes the first approver and the queued verdict so a
 * second admin can inspect the exact pending outcome before signing it.
 */
export interface PendingResolution {
  approver: string;
  verdict: ResolutionVerdict;
}

/**
 * Payload emitted by the `resolution_approval_requested` event.
 * Includes the queued verdict so off-chain observers can detect a changed
 * proposal before the second approval.
 */
export interface ResolutionApprovalRequestedEvent {
  caller: string;
  amount: bigint;
  verdict: ResolutionVerdict;
}

export { DisputeCase, DisputeStatus };