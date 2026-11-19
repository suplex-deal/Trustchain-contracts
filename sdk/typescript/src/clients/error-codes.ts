const ERROR_NAMES: Record<number, string[]> = {
  1: [
    'TrustchainError.Unauthorized',
    'EscrowError.InvalidState',
    'DeliveryError.InvalidState',
    'FleetError.AlreadyInitialized',
    'SettlementError.SwapNotImplemented',
  ],
  2: [
    'TrustchainError.AlreadyInitialized',
    'EscrowError.DeliveryNotFound',
    'DeliveryError.InvalidMetadata',
    'FleetError.NotInitialized',
  ],
  3: [
    'TrustchainError.NotInitialized',
    'EscrowError.InsufficientFunds',
    'DeliveryError.BatchTooLarge',
    'FleetError.Unauthorized',
  ],
  4: [
    'TrustchainError.DeliveryNotFound',
    'EscrowError.DuplicateDelivery',
    'DeliveryError.InvalidDriver',
    'FleetError.FleetNotFound',
  ],
  5: [
    'TrustchainError.InvalidState',
    'EscrowError.InvalidFee',
    'DeliveryError.InvalidParties',
    'FleetError.DriverAlreadyInvited',
  ],
  6: [
    'TrustchainError.InsufficientFunds',
    'EscrowError.InvalidToken',
    'FleetError.InviteNotFound',
  ],
  7: ['EscrowError.InvalidAmount', 'FleetError.DriverAlreadyActive'],
  8: [
    'TrustchainError.DuplicateDelivery',
    'EscrowError.NoPendingSettlementChange',
    'FleetError.NoPendingTreasuryChange',
  ],
  9: [
    'TrustchainError.ProviderNotFound',
    'EscrowError.TimelockNotElapsed',
    'FleetError.TimelockNotElapsed',
  ],
  10: ['EscrowError.InvalidDriver', 'FleetError.FleetInactive'],
  11: [
    'TrustchainError.ProtocolPaused',
    'EscrowError.InvalidParties',
    'FleetError.InvalidConfiguration',
  ],
  12: [
    'TrustchainError.LimitExceeded',
    'FleetError.InternalStorageError',
  ],
  13: ['FleetError.DriverNotRegistered'],
  18: ['FleetError.InviteExpired'],
};

export function formatSorobanError(
  context: string,
  error: string,
  explicitCodes: number[] = []
): string {
  const parsedCodes = error.match(/#(\d+)\b/g)?.map((match) => Number(match.slice(1))) ?? [];
  const codes = [...new Set([...explicitCodes, ...parsedCodes])];
  const details = codes
    .map((code) => {
      const names = ERROR_NAMES[code];
      return names?.length
        ? `#${code}: ${names.join(', ')}`
        : undefined;
    })
    .filter((detail): detail is string => detail !== undefined);
  const detail = details.length
    ? ` (known contract error names: ${details.join('; ')}; the exact name depends on the failing contract)`
    : '';

  return `${context}: ${error}${detail}`;
}
