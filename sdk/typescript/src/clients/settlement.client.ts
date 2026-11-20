/**
 * Typed SDK client for SettlementContract
 */

import { ContractInvokeOptions } from '../types/common.types';
import * as SettlementTypes from '../types/settlement.types';
import { ContractInvoker, address, i128, u64 } from './invoker';

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

  /**
   * Read the receipt of a completed swap for `(escrow, deliveryId)`, or `null`
   * if that escrow record has not been settled through this contract.
   */
  async getSwapReceipt(
    escrow: string,
    deliveryId: bigint | number,
    options?: ContractInvokeOptions
  ): Promise<SettlementTypes.SwapReceipt | null> {
    const value = (await this.invoker.call(
      'get_swap_receipt',
      [address(escrow), u64(deliveryId)],
      options
    )) as Record<string, unknown> | null | undefined;
    if (value === null || value === undefined) {
      return null;
    }
    return {
      driver: String(value.driver),
      recipient: String(value.recipient),
      fromToken: String(value.from_token),
      toToken: String(value.to_token),
      amountIn: BigInt(value.amount_in as bigint),
      amountOut: BigInt(value.amount_out as bigint),
      settledAt: BigInt(value.settled_at as bigint),
    };
  }

  /**
   * Execute a settlement swap. Resolves to the measured output amount the
   * recipient received; the contract also emits `settlement_swap_executed`.
   */
  async executeSettlementSwap(
    params: SettlementTypes.ExecuteSettlementSwapParams,
    options?: ContractInvokeOptions
  ): Promise<bigint> {
    const amountOut = await this.invoker.call(
      'execute_settlement_swap',
      [
        address(params.caller),
        u64(params.deliveryId),
        address(params.driver),
        address(params.fromToken),
        address(params.toToken),
        address(params.recipient),
        i128(params.amount),
        i128(params.minAmountOut),
        u64(params.deadline),
      ],
      options
    );
    return BigInt(amountOut as bigint);
  }
}
