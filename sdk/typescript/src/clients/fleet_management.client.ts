/**
 * Typed SDK client for FleetManagementContract
 */

import { ContractInvokeOptions, DriverFleetStatus, FleetProfile, PendingTreasuryChange } from '../types/common.types';
import * as FleetManagementTypes from '../types/fleet_management.types';
import { ContractInvoker, address, u32, u64, vec } from './invoker';

/**
 * Maximum roster entries the contract returns for a single `get_fleet_roster`
 * call, mirroring `MAX_ROSTER_PAGE_SIZE` in fleet_management_contract. The
 * contract clamps any larger `limit`, so this is a client-side convenience
 * default for a single full-page read.
 */
const DEFAULT_ROSTER_PAGE_SIZE = 100;

export class FleetManagementClient {
  private readonly invoker: ContractInvoker;

  constructor(contractId: string, options: ContractInvokeOptions = {}) {
    this.invoker = new ContractInvoker(contractId, options);
  }

  async init(admin: string, options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('init', [address(admin)], options);
  }

  async setIdentityContract(params: FleetManagementTypes.SetIdentityContractParams, options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('set_identity_contract', [address(params.admin), address(params.identityContract)], options);
  }

  async confirmIdentityContract(options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('confirm_identity_contract', [], options);
  }

  /**
   * Return the identity contract change queued by `setIdentityContract`, or
   * `null` when no change is pending. Lets operators inspect the pending peer
   * address and its activation time before calling `confirmIdentityContract`.
   * Exposes the on-chain `get_pending_identity_contract` query.
   */
  async getPendingIdentityContract(options?: ContractInvokeOptions): Promise<FleetManagementTypes.PendingContractAddress | null> {
    const value = await this.invoker.call('get_pending_identity_contract', [], options);
    return value == null ? null : decodePendingContractAddress(value, 'get_pending_identity_contract');
  }

  /**
   * Return the configured identity_reputation_contract address, if any.
   * Returns `null` when no identity contract has been wired to this fleet contract yet.
   * Exposes the on-chain `get_identity_contract` read getter (Issue #486).
   */
  async getIdentityContract(options?: ContractInvokeOptions): Promise<string | null> {
    const result = await this.invoker.call('get_identity_contract', [], options);
    return result == null ? null : String(result);
  }

  async setEscrowContract(params: FleetManagementTypes.SetEscrowContractParams, options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('set_escrow_contract', [address(params.admin), address(params.escrowContract)], options);
  }

  async confirmEscrowContract(options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('confirm_escrow_contract', [], options);
  }

  /**
   * Return the escrow contract change queued by `setEscrowContract`, or `null`
   * when no change is pending. Lets operators verify which escrow address will
   * become active (and when) before anyone calls `confirmEscrowContract`.
   * Exposes the on-chain `get_pending_escrow_contract` query.
   */
  async getPendingEscrowContract(options?: ContractInvokeOptions): Promise<FleetManagementTypes.PendingContractAddress | null> {
    const value = await this.invoker.call('get_pending_escrow_contract', [], options);
    return value == null ? null : decodePendingContractAddress(value, 'get_pending_escrow_contract');
  }

  /**
   * Return the configured escrow_contract address, if any.
   * Returns `null` when no escrow contract has been wired to this fleet contract yet.
   * Exposes the on-chain `get_escrow_contract` read getter (Issue #486).
   */
  async getEscrowContract(options?: ContractInvokeOptions): Promise<string | null> {
    const result = await this.invoker.call('get_escrow_contract', [], options);
    return result == null ? null : String(result);
  }

  async registerFleet(params: FleetManagementTypes.RegisterFleetParams, options?: ContractInvokeOptions): Promise<bigint> {
    return BigInt(String(await this.invoker.call('register_fleet', [address(params.owner), address(params.treasury)], options)));
  }

  async getFleet(fleetId: bigint, options?: ContractInvokeOptions): Promise<FleetProfile> {
    return decodeFleet(await this.invoker.call('get_fleet', [u64(fleetId)], options));
  }

  async deactivateFleet(params: FleetManagementTypes.DeactivateFleetParams, options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('deactivate_fleet', [address(params.caller), u64(params.fleetId)], options);
  }

  async reactivateFleet(params: FleetManagementTypes.ReactivateFleetParams, options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('reactivate_fleet', [address(params.caller), u64(params.fleetId)], options);
  }

  async adminReassignFleetOwner(params: FleetManagementTypes.AdminReassignFleetOwnerParams, options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('admin_reassign_fleet_owner', [address(params.admin), u64(params.fleetId), address(params.newOwner)], options);
  }

  async acceptFleetOwnerReassignment(fleetId: bigint, newOwner: string, options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('accept_fleet_owner_reassignment', [address(newOwner), u64(fleetId)], options);
  }

  /**
   * Return the admin-proposed owner reassignment pending for `fleetId`, or
   * `null` when none is pending. Lets the incoming owner inspect who proposed
   * the change before calling `acceptFleetOwnerReassignment`.
   * Exposes the on-chain `get_pending_fleet_owner_reassignment` query.
   */
  async getPendingFleetOwnerReassignment(
    fleetId: bigint,
    options?: ContractInvokeOptions,
  ): Promise<FleetManagementTypes.PendingFleetOwnerReassignment | null> {
    const value = await this.invoker.call('get_pending_fleet_owner_reassignment', [u64(fleetId)], options);
    return value == null ? null : decodePendingFleetOwnerReassignment(value);
  }

  async adminForceUpdateTreasury(params: FleetManagementTypes.AdminForceUpdateTreasuryParams, options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('admin_force_update_treasury', [address(params.admin), u64(params.fleetId), address(params.newTreasury)], options);
  }

  async updateFleetTreasury(params: FleetManagementTypes.UpdateFleetTreasuryParams, options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('update_fleet_treasury', [address(params.owner), u64(params.fleetId), address(params.treasury), vec((params.coSigners ?? []).map(address))], options);
  }

  async confirmFleetTreasuryUpdate(params: FleetManagementTypes.ConfirmFleetTreasuryUpdateParams, options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('confirm_fleet_treasury_update', [u64(params.fleetId)], options);
  }

  async getPendingTreasuryUpdate(fleetId: bigint, options?: ContractInvokeOptions): Promise<PendingTreasuryChange | null> {
    const value = await this.invoker.call('get_pending_treasury_update', [u64(fleetId)], options);
    return value == null ? null : decodePendingTreasury(value);
  }

  async addDriverToFleet(params: FleetManagementTypes.AddDriverToFleetParams, options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('add_driver_to_fleet', [address(params.caller), u64(params.fleetId), address(params.driver), vec((params.coSigners ?? []).map(address))], options);
  }

  async cancelInvite(params: FleetManagementTypes.CancelInviteParams, options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('cancel_invite', [address(params.owner), u64(params.fleetId), address(params.driver), vec((params.coSigners ?? []).map(address))], options);
  }

  async acceptFleetInvite(params: FleetManagementTypes.AcceptFleetInviteParams, options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('accept_fleet_invite', [u64(params.fleetId), address(params.driver)], options);
  }

  async removeDriverFromFleet(params: FleetManagementTypes.RemoveDriverFromFleetParams, options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('remove_driver_from_fleet', [u64(params.fleetId), address(params.caller), address(params.driver), vec((params.coSigners ?? []).map(address))], options);
  }

  async getPayoutAddress(driver: string, fleetId: bigint, options?: ContractInvokeOptions): Promise<string> {
    return String(await this.invoker.call('get_payout_address', [address(driver), u64(fleetId)], options));
  }

  async getDriverFleetStatus(fleetId: bigint, driver: string, options?: ContractInvokeOptions): Promise<DriverFleetStatus | null> {
    const result = await this.invoker.call('get_driver_fleet_status', [u64(fleetId), address(driver)], options);
    return result == null ? null : (result as DriverFleetStatus);
  }

  async getFleetRoster(params: FleetManagementTypes.GetFleetRosterParams, options?: ContractInvokeOptions): Promise<string[]> {
    const offset = params.offset ?? 0;
    const limit = params.limit ?? DEFAULT_ROSTER_PAGE_SIZE;
    const result = await this.invoker.call(
      'get_fleet_roster',
      [u64(params.fleetId), u32(offset), u32(limit)],
      options
    );
    return (result as unknown[]).map((value) => String(value));
  }

  async configureSigners(params: FleetManagementTypes.ConfigureSignersParams, options?: ContractInvokeOptions): Promise<void> {
    const coSigners = params.coSigners || [];
    await this.invoker.call('configure_signers', [address(params.owner), u64(params.fleetId), vec(params.signers.map(address)), u32(params.threshold), vec(coSigners.map(address))], options);
  }

  async getFleetSigners(fleetId: bigint, options?: ContractInvokeOptions): Promise<{ signers: string[]; threshold: number }> {
    const result = await this.invoker.call('get_fleet_signers', [u64(fleetId)], options) as unknown[];
    const signers = (result[0] as unknown[]).map((value) => String(value));
    return { signers, threshold: Number(result[1]) };
  }
}

function decodeFleet(value: unknown): FleetProfile {
  const profile = value as Record<string, unknown>;
  return {
    fleetId: BigInt(String(profile.fleet_id)),
    owner: String(profile.owner),
    treasury: String(profile.treasury),
    totalActiveDrivers: Number(profile.total_active_drivers),
    signers: ((profile.signers as unknown[]) ?? []).map((value) => String(value)),
    signatureThreshold: Number(profile.signature_threshold),
    active: Boolean(profile.active),
  };
}

function decodePendingTreasury(value: unknown): PendingTreasuryChange {
  const change = value as Record<string, unknown>;
  return {
    treasury: String(change.treasury),
    activatesAt: Number(change.activates_at),
  };
}

/** Read a required field from a decoded contract record, rejecting absent values. */
function requireField(record: Record<string, unknown>, field: string, source: string): unknown {
  const value = record[field];
  if (value === undefined || value === null) {
    throw new Error(`${source}: malformed record, missing field '${field}'`);
  }
  return value;
}

function asRecord(value: unknown, source: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${source}: expected a struct record, received ${Array.isArray(value) ? 'array' : typeof value}`);
  }
  return value as Record<string, unknown>;
}

function decodePendingContractAddress(value: unknown, source: string): FleetManagementTypes.PendingContractAddress {
  const record = asRecord(value, source);
  return {
    address: String(requireField(record, 'address', source)),
    proposedBy: String(requireField(record, 'proposed_by', source)),
    activatesAt: BigInt(String(requireField(record, 'activates_at', source))),
  };
}

function decodePendingFleetOwnerReassignment(value: unknown): FleetManagementTypes.PendingFleetOwnerReassignment {
  const source = 'get_pending_fleet_owner_reassignment';
  const record = asRecord(value, source);
  return {
    newOwner: String(requireField(record, 'new_owner', source)),
    admin: String(requireField(record, 'admin', source)),
  };
}
