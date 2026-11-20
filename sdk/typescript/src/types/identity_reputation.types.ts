import { DriverProfile, DriverTier, ReputationConfig, UserProfile } from './common.types';

export interface InitParams {
  admin: string;
  deliveryContract: string;
  disputeContract: string;
}

export interface SetAuthorizedContractParams {
  admin: string;
  contractAddr: string;
  authorized: boolean;
}

export interface SetReputationConfigParams {
  admin: string;
  config: ReputationConfig;
}

export interface SetDeliveryContractParams {
  admin: string;
  deliveryContract: string;
}

export interface SetDisputeContractParams {
  admin: string;
  disputeContract: string;
}

/**
 * Mirrors the Rust `PendingPeerContractChange` struct returned by
 * `get_pending_delivery_contract`. Present only when a timelock proposal
 * to change the delivery contract peer address is in-flight; `null` means
 * no change is pending.
 */
export interface PendingDeliveryContractInfo {
  /** The proposed new delivery contract address. */
  address: string;
  /** The admin address that proposed the change. */
  proposedBy: string;
  /** Unix timestamp (seconds) after which the change may be confirmed. */
  activatesAt: bigint;
}

export interface RegisterDriverParams {
  driver: string;
}

export interface RegisterUserParams {
  user: string;
}

export interface SuspendDriverParams {
  admin: string;
  driver: string;
}

export interface ReinstateDriverParams {
  admin: string;
  driver: string;
}

export interface UpdateDriverKycStatusParams {
  admin: string;
  driver: string;
  kycVerified: boolean;
}

export interface IncreaseReputationParams {
  caller: string;
  driver: string;
  deliveryId: bigint;
  weightGrams: number;
  fragile: boolean;
}

export interface DecreaseReputationParams {
  caller: string;
  driver: string;
  points: number;
}

export interface AwardReputationParams {
  caller: string;
  driver: string;
  points: number;
}

export { DriverProfile, DriverTier, ReputationConfig, UserProfile };
