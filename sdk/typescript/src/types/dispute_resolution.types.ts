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

export { DisputeCase, DisputeStatus };
