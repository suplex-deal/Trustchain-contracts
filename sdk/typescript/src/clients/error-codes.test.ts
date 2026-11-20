import { formatSorobanError } from './error-codes';

describe('Soroban contract error formatting', () => {
  test('adds documented names while preserving the original RPC message', () => {
    expect(formatSorobanError('Soroban simulation failed', 'Error(Contract, #5)')).toBe(
      'Soroban simulation failed: Error(Contract, #5) (known contract error names: #5: TrustchainError.InvalidState, EscrowError.InvalidFee, DeliveryError.InvalidParties, FleetError.DriverAlreadyInvited; the exact name depends on the failing contract)'
    );
  });

  test('formats contract error codes decoded from failed transaction diagnostics', () => {
    expect(formatSorobanError('Soroban transaction failed', 'Error(Contract, #4)', [4])).toContain(
      'TrustchainError.DeliveryNotFound'
    );
  });

  test('includes the documented settlement error name for code 1', () => {
    expect(formatSorobanError('Soroban simulation failed', 'Error(Contract, #1)')).toContain(
      'SettlementError.SwapNotImplemented'
    );
  });

  test('includes the settlement swap-binding error names', () => {
    expect(formatSorobanError('Soroban simulation failed', 'Error(Contract, #8)')).toContain(
      'SettlementError.PreferenceMismatch'
    );
    expect(formatSorobanError('Soroban simulation failed', 'Error(Contract, #9)')).toContain(
      'SettlementError.InvalidSwapRecipient'
    );
    expect(formatSorobanError('Soroban simulation failed', 'Error(Contract, #10)')).toContain(
      'SettlementError.SwapAlreadySettled'
    );
  });

  test('does not alter errors without a documented contract code', () => {
    expect(formatSorobanError('Soroban simulation failed', 'network unavailable')).toBe(
      'Soroban simulation failed: network unavailable'
    );
  });
});
