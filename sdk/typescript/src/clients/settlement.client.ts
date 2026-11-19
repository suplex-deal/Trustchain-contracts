/**
 * Typed SDK client for SettlementContract
 */

import { StrKey } from '@stellar/stellar-sdk';
import { ContractInvokeOptions } from '../types/common.types';
import * as SettlementTypes from '../types/settlement.types';
import { ContractInvoker, address, i128 } from './invoker';

export class SettlementClient {
  private readonly invoker: ContractInvoker;

  constructor(contractId: string, options: ContractInvokeOptions = {}) {
    this.invoker = new ContractInvoker(contractId, options);
  }

  async init(params: SettlementTypes.InitParams, options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('init', [address(params.admin), address(params.escrowContract)], options);
  }

  async getAdmin(options?: ContractInvokeOptions): Promise<string> {
    return String(await this.invoker.call('get_admin', [], options));
  }

  /**
   * Propose a new escrow peer (admin only). Starts the
   * `PEER_CONTRACT_CHANGE_TIMELOCK_SECONDS` review period; the active escrow
   * contract is unchanged until `confirmEscrowContract` succeeds. A new
   * proposal replaces any pending one and restarts the timelock.
   *
   * Reverts with `Unauthorized` when `admin` is not the stored admin and
   * `NotInitialized` before `init`.
   */
  async proposeEscrowContract(
    params: SettlementTypes.ProposeEscrowContractParams,
    options?: ContractInvokeOptions
  ): Promise<void> {
    await this.invoker.call('set_escrow_contract', [address(params.admin), address(params.newEscrow)], options);
  }

  /**
   * Apply the pending escrow peer once its timelock has elapsed. Permissionless
   * on-chain, so it takes no arguments.
   *
   * Reverts with `NoPendingContractChange` when nothing is pending and
   * `ContractChangeTimelockNotElapsed` while `now < activatesAt`.
   */
  async confirmEscrowContract(options?: ContractInvokeOptions): Promise<void> {
    await this.invoker.call('confirm_escrow_contract', [], options);
  }

  /** Read the in-flight escrow peer proposal, or `null` when none is pending. */
  async getPendingEscrowContract(
    options?: ContractInvokeOptions
  ): Promise<SettlementTypes.PendingEscrowContractChange | null> {
    const raw = await this.invoker.call('get_pending_escrow_contract', [], options);
    if (raw === null || raw === undefined) return null;
    const record = raw as Record<string, unknown>;
    return {
      address: String(record.address),
      proposedBy: String(record.proposed_by),
      activatesAt: BigInt(String(record.activates_at)),
    };
  }

  /** Read the currently active escrow peer. Reverts with `NotInitialized` before `init`. */
  async getEscrowContract(options?: ContractInvokeOptions): Promise<string> {
    return String(await this.invoker.call('get_escrow_contract', [], options));
  }

  /**
   * Configure the trusted swap router (admin only). Overwrites any existing
   * router. `router` must be a contract (`C...`) address; anything else is
   * rejected locally before a transaction is built.
   *
   * Reverts with `Unauthorized` when `admin` is not the stored admin.
   */
  async setSwapRouter(params: SettlementTypes.SetSwapRouterParams, options?: ContractInvokeOptions): Promise<void> {
    if (!StrKey.isValidContract(params.router)) {
      throw new TypeError(`router must be a contract address (C...), got "${params.router}"`);
    }
    await this.invoker.call('set_swap_router', [address(params.admin), address(params.router)], options);
  }

  /**
   * Read the configured swap router, or `null` when none is set (in which case
   * `execute_settlement_swap` reverts with `SwapRouterNotConfigured`).
   */
  async getSwapRouter(options?: ContractInvokeOptions): Promise<string | null> {
    const value = await this.invoker.call('get_swap_router', [], options);
    return value === null || value === undefined ? null : String(value);
  }

  async getDriverPreference(driver: string, options?: ContractInvokeOptions): Promise<string | null> {
    const value = await this.invoker.call('get_driver_preference', [address(driver)], options);
    return value === null || value === undefined ? null : String(value);
  }

  async setDriverPreference(
    params: SettlementTypes.SetDriverPreferenceParams,
    options?: ContractInvokeOptions
  ): Promise<void> {
    await this.invoker.call('set_driver_preference', [address(params.driver), address(params.toToken)], options);
  }

  async executeSettlementSwap(
    params: SettlementTypes.ExecuteSettlementSwapParams,
    options?: ContractInvokeOptions
  ): Promise<void> {
    await this.invoker.call(
      'execute_settlement_swap',
      [
        address(params.caller),
        address(params.fromToken),
        address(params.toToken),
        address(params.recipient),
        i128(params.amount),
        i128(params.minAmountOut),
      ],
      options
    );
  }
}

/**
 * Whether a pending escrow peer change can be confirmed at `nowSeconds`
 * (ledger timestamp). Matches the contract check `now >= activatesAt`.
 */
export function isEscrowContractChangeReady(
  pending: SettlementTypes.PendingEscrowContractChange | null,
  nowSeconds: bigint
): boolean {
  return pending !== null && nowSeconds >= pending.activatesAt;
}
