export interface InitParams {
  admin: string;
  escrowContract: string;
}

export interface SetDriverPreferenceParams {
  driver: string;
  toToken: string;
}

export interface ExecuteSettlementSwapParams {
  /** Must be the configured escrow contract; it must authorize the call. */
  caller: string;
  /** Escrow delivery ID this swap pays out, used to correlate swap and escrow record. */
  deliveryId: bigint | number;
  /** Driver being paid; `toToken` must equal this driver's recorded preference. */
  driver: string;
  fromToken: string;
  toToken: string;
  recipient: string;
  amount: bigint;
  minAmountOut: bigint;
  /** Unix timestamp; must be within 300 seconds of the current ledger time. */
  deadline: bigint | number;
}

/**
 * Payload of the `settlement_swap_executed` event emitted by
 * `execute_settlement_swap`. Binds the swap output to the escrow delivery it
 * pays, so off-chain reconciliation does not depend on router events.
 */
export interface SettlementSwapExecutedEvent {
  escrowContract: string;
  deliveryId: bigint;
  driver: string;
  fromToken: string;
  toToken: string;
  recipient: string;
  /** Exact `fromToken` amount consumed by the router. */
  amountIn: bigint;
  /** Actual `toToken` amount received by `recipient` (measured balance delta). */
  amountOut: bigint;
}

export const SETTLEMENT_SWAP_EXECUTED_EVENT = 'settlement_swap_executed';

/** Receipt stored for each completed swap, keyed by `(escrow, deliveryId)`. */
export interface SwapReceipt {
  driver: string;
  recipient: string;
  fromToken: string;
  toToken: string;
  amountIn: bigint;
  amountOut: bigint;
  settledAt: bigint;
}
