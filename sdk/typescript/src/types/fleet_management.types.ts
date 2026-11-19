import { DriverFleetStatus, FleetProfile, PendingTreasuryChange } from './common.types';

/**
 * Contract-specific error codes raised by
 * `fleet_management_contract::FleetError`. Distinct from the shared
 * `TrustchainError` codes in `common.types.ts`.
 */
export const FleetErrorCodes = {
  FleetNotFound: 4,
  DriverAlreadyInvited: 5,
  InviteNotFound: 6,
  DriverAlreadyActive: 7,
  NoPendingTreasuryChange: 8,
  FleetInactive: 10,
  InvalidConfiguration: 11,
  InternalStorageError: 12,
  DriverNotRegistered: 13,
  RosterFull: 14,
  InviteExpired: 18,
} as const;

/**
 * Seconds a driver has to accept a fleet invitation, mirroring
 * `INVITE_ACCEPTANCE_WINDOW_SECONDS` in fleet_management_contract.
 */
export const INVITE_ACCEPTANCE_WINDOW_SECONDS = 7 * 24 * 60 * 60;

export interface RegisterFleetParams {
  owner: string;
  treasury: string;
}

export interface SetIdentityContractParams {
  admin: string;
  identityContract: string;
}

export interface SetEscrowContractParams {
  admin: string;
  escrowContract: string;
}

export interface FleetIdParams {
  fleetId: bigint;
}

export interface DeactivateFleetParams {
  caller: string;
  fleetId: bigint;
}

export interface ReactivateFleetParams {
  caller: string;
  fleetId: bigint;
}

export interface AdminReassignFleetOwnerParams {
  admin: string;
  fleetId: bigint;
  newOwner: string;
}

export interface AdminForceUpdateTreasuryParams {
  admin: string;
  fleetId: bigint;
  newTreasury: string;
}

export interface UpdateFleetTreasuryParams {
  owner: string;
  fleetId: bigint;
  treasury: string;
  /** Additional signer authorizations needed to meet the fleet's signature_threshold beyond `owner` alone. Pass [] for a threshold-1 fleet. */
  coSigners?: string[];
}

export interface ConfirmFleetTreasuryUpdateParams {
  fleetId: bigint;
}

export interface AddDriverToFleetParams {
  caller: string;
  fleetId: bigint;
  driver: string;
  /** Additional signer authorizations needed to meet the fleet's signature_threshold beyond `caller` alone. Pass [] for a threshold-1 fleet. */
  coSigners?: string[];
}

export interface CancelInviteParams {
  owner: string;
  fleetId: bigint;
  driver: string;
  /** Additional signer authorizations needed to meet the fleet's signature_threshold beyond `owner` alone. Pass [] for a threshold-1 fleet. */
  coSigners?: string[];
}

export interface AcceptFleetInviteParams {
  fleetId: bigint;
  driver: string;
}

export interface RemoveDriverFromFleetParams {
  fleetId: bigint;
  caller: string;
  driver: string;
  /** Additional signer authorizations needed to meet the fleet's signature_threshold beyond `caller` alone. Pass [] (or omit) when the driver is removing themselves. */
  coSigners?: string[];
}

export interface ConfigureSignersParams {
  owner: string;
  fleetId: bigint;
  signers: string[];
  threshold: number;
  coSigners?: string[];
}

export { DriverFleetStatus, FleetProfile, PendingTreasuryChange };

export interface GetFleetRosterParams {
  fleetId: bigint;
  /** Roster index to start reading from. Defaults to 0. */
  offset?: number;
  /**
   * Maximum number of drivers to return. Defaults to
   * {@link DEFAULT_ROSTER_PAGE_SIZE} and is clamped by the contract to
   * {@link MAX_ROSTER_PAGE_SIZE}.
   */
  limit?: number;
}

/** Parameters for `renew_fleet_roster`; same paging semantics as {@link GetFleetRosterParams}. */
export interface RenewFleetRosterParams {
  fleetId: bigint;
  /** Roster index to start renewing from. Defaults to 0. */
  offset?: number;
  /** Maximum number of roster entries to renew. Clamped by the contract to `MAX_ROSTER_PAGE_SIZE`. */
  limit?: number;
}
