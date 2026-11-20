export interface InitParams {
  admin: string;
  escrowContract: string;
}

export interface SetDriverPreferenceParams {
  driver: string;
  toToken: string;
}

export interface ExecuteSettlementSwapParams {
  caller: string;
  fromToken: string;
  toToken: string;
  recipient: string;
  amount: bigint;
  minAmountOut: bigint;
  /**
   * Unix timestamp (seconds, u64) after which the swap is rejected. Must not
   * be in the past and no more than 300 seconds after the current ledger
   * timestamp (`SETTLEMENT_SWAP_DEADLINE_WINDOW_SECONDS`).
   */
  deadline: bigint;
}
