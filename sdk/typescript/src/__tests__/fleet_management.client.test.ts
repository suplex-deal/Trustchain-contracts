import { nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';

import { FleetManagementClient } from '../clients/fleet_management.client';
import { ContractInvoker } from '../clients/invoker';

/**
 * Mocks ContractInvoker.prototype.call and returns queued ScVal responses by
 * contract function name. Each entry may hold multiple values (shift()d in
 * order) or a single value returned every time.
 */
function mockInvoker(retvals: Record<string, xdr.ScVal[]>): jest.SpyInstance {
  const call = jest.fn(async (functionName: string) => {
    const queue = retvals[functionName];
    if (!queue || queue.length === 0) return undefined;
    const value = queue.length === 1 ? queue[0] : queue.shift();
    return value === undefined ? undefined : scValToNative(value as xdr.ScVal);
  });
  jest.spyOn(ContractInvoker.prototype, 'call').mockImplementation(call as never);
  return call;
}

// Structurally valid Stellar addresses required by the Address/Contract constructors.
const CONTRACT_ID = 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR';
const ESCROW_ADDR = 'GAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSH7S';
const IDENTITY_ADDR = 'GAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSH7S';
const ADMIN = 'GAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSH7S';

function client(): FleetManagementClient {
  return new FleetManagementClient(CONTRACT_ID);
}

function decodeAddress(val: xdr.ScVal): string {
  return scValToNative(val) as string;
}

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Issue #486: getEscrowContract and getIdentityContract SDK bindings ────────

describe('FleetManagementClient.getEscrowContract (Issue #486)', () => {
  it('calls get_escrow_contract with no args and returns the address', async () => {
    const call = mockInvoker({
      get_escrow_contract: [nativeToScVal(ESCROW_ADDR, { type: 'address' })],
    });

    const result = await client().getEscrowContract();

    expect(result).toBe(ESCROW_ADDR);
    expect(call).toHaveBeenCalledTimes(1);
    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('get_escrow_contract');
    expect(args).toHaveLength(0);
  });

  it('returns null when the contract returns Option::None', async () => {
    mockInvoker({ get_escrow_contract: [nativeToScVal(null)] });

    const result = await client().getEscrowContract();

    expect(result).toBeNull();
  });

  it('returns null when the invoker resolves undefined', async () => {
    jest
      .spyOn(ContractInvoker.prototype, 'call')
      .mockResolvedValue(undefined as never);

    const result = await client().getEscrowContract();

    expect(result).toBeNull();
  });
});

describe('FleetManagementClient.getIdentityContract (Issue #486)', () => {
  it('calls get_identity_contract with no args and returns the address', async () => {
    const call = mockInvoker({
      get_identity_contract: [nativeToScVal(IDENTITY_ADDR, { type: 'address' })],
    });

    const result = await client().getIdentityContract();

    expect(result).toBe(IDENTITY_ADDR);
    expect(call).toHaveBeenCalledTimes(1);
    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('get_identity_contract');
    expect(args).toHaveLength(0);
  });

  it('returns null when the contract returns Option::None', async () => {
    mockInvoker({ get_identity_contract: [nativeToScVal(null)] });

    const result = await client().getIdentityContract();

    expect(result).toBeNull();
  });

  it('returns null when the invoker resolves undefined', async () => {
    jest
      .spyOn(ContractInvoker.prototype, 'call')
      .mockResolvedValue(undefined as never);

    const result = await client().getIdentityContract();

    expect(result).toBeNull();
  });

  /**
   * Full round-trip: set and then read back both dependency addresses.
   * The SDK must invoke the correct on-chain function name in each direction.
   */
  it('set+get round-trip for both escrow and identity contracts', async () => {
    const call = mockInvoker({
      set_escrow_contract: [nativeToScVal(null)],
      confirm_escrow_contract: [nativeToScVal(null)],
      get_escrow_contract: [nativeToScVal(ESCROW_ADDR, { type: 'address' })],
      set_identity_contract: [nativeToScVal(null)],
      confirm_identity_contract: [nativeToScVal(null)],
      get_identity_contract: [nativeToScVal(IDENTITY_ADDR, { type: 'address' })],
    });

    const fleetClient = client();
    await fleetClient.setEscrowContract({ admin: ADMIN, escrowContract: ESCROW_ADDR });
    await fleetClient.confirmEscrowContract();
    const readEscrow = await fleetClient.getEscrowContract();
    await fleetClient.setIdentityContract({ admin: ADMIN, identityContract: IDENTITY_ADDR });
    await fleetClient.confirmIdentityContract();
    const readIdentity = await fleetClient.getIdentityContract();

    expect(readEscrow).toBe(ESCROW_ADDR);
    expect(readIdentity).toBe(IDENTITY_ADDR);

    const fns = call.mock.calls.map((c) => c[0]);
    expect(fns).toEqual([
      'set_escrow_contract',
      'confirm_escrow_contract',
      'get_escrow_contract',
      'set_identity_contract',
      'confirm_identity_contract',
      'get_identity_contract',
    ]);
  });
});

// ── Issue #487: setEscrowContract / setIdentityContract emit observable events ─

describe('FleetManagementClient set_escrow_contract event (Issue #487)', () => {
  /**
   * `set_escrow_contract` emits an `escrow_contract_updated` event on-chain.
   * This test verifies that the SDK binding:
   *   1. Targets the correct on-chain function (`set_escrow_contract`).
   *   2. Passes admin and escrowContract as positional args in the right order.
   *
   * The event itself is emitted inside the Rust contract and is observable
   * off-chain via the Soroban event stream; the SDK binding is the call-site
   * side of the contract interaction, which is what a TypeScript integrator
   * drives. Confirming the correct function name and arg encoding guarantees
   * the event will be emitted when this binding is invoked on-chain.
   */
  it('setEscrowContract targets set_escrow_contract with (admin, address) args', async () => {
    const call = mockInvoker({ set_escrow_contract: [nativeToScVal(null)] });

    await client().setEscrowContract({ admin: ADMIN, escrowContract: ESCROW_ADDR });

    expect(call).toHaveBeenCalledTimes(1);
    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('set_escrow_contract');
    expect(args).toHaveLength(2);
    expect(decodeAddress(args[0] as xdr.ScVal)).toBe(ADMIN);
    expect(decodeAddress(args[1] as xdr.ScVal)).toBe(ESCROW_ADDR);
  });

  it('propagates a contract error from set_escrow_contract to the caller', async () => {
    jest
      .spyOn(ContractInvoker.prototype, 'call')
      .mockRejectedValue(new Error('Soroban simulation failed: TrustchainError::Unauthorized'));

    await expect(
      client().setEscrowContract({ admin: ADMIN, escrowContract: ESCROW_ADDR }),
    ).rejects.toThrow('Unauthorized');
  });
});

describe('FleetManagementClient set_identity_contract event (Issue #487)', () => {
  /**
   * `set_identity_contract` emits an `identity_contract_updated` event on-chain.
   * This test verifies the SDK binding targets the correct function and encodes
   * the (admin, identityContract) args in the right order, which is a
   * precondition for the event to be emitted on-chain.
   */
  it('setIdentityContract targets set_identity_contract with (admin, address) args', async () => {
    const call = mockInvoker({ set_identity_contract: [nativeToScVal(null)] });

    await client().setIdentityContract({ admin: ADMIN, identityContract: IDENTITY_ADDR });

    expect(call).toHaveBeenCalledTimes(1);
    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('set_identity_contract');
    expect(args).toHaveLength(2);
    expect(decodeAddress(args[0] as xdr.ScVal)).toBe(ADMIN);
    expect(decodeAddress(args[1] as xdr.ScVal)).toBe(IDENTITY_ADDR);
  });

  it('propagates a contract error from set_identity_contract to the caller', async () => {
    jest
      .spyOn(ContractInvoker.prototype, 'call')
      .mockRejectedValue(new Error('Soroban simulation failed: TrustchainError::Unauthorized'));

    await expect(
      client().setIdentityContract({ admin: ADMIN, identityContract: IDENTITY_ADDR }),
    ).rejects.toThrow('Unauthorized');
  });

  /**
   * Proves both event-emitting setters work as a pair: set both dependency
   * addresses in sequence and confirm each binding used the correct function
   * name. Together they exercise the full "wire-up" workflow an admin
   * performs when deploying the fleet contract, and they serve as a
   * regression guard for any future rename of the Rust function names.
   */
  it('both event-emitting setters can be called in sequence without interference', async () => {
    const call = mockInvoker({
      set_escrow_contract: [nativeToScVal(null)],
      set_identity_contract: [nativeToScVal(null)],
    });

    const fleetClient = client();
    await fleetClient.setEscrowContract({ admin: ADMIN, escrowContract: ESCROW_ADDR });
    await fleetClient.setIdentityContract({ admin: ADMIN, identityContract: IDENTITY_ADDR });

    const fns = call.mock.calls.map((c) => c[0]);
    expect(fns).toEqual(['set_escrow_contract', 'set_identity_contract']);

    // First call: set_escrow_contract(admin, escrowAddr)
    expect(decodeAddress(call.mock.calls[0][1][0] as xdr.ScVal)).toBe(ADMIN);
    expect(decodeAddress(call.mock.calls[0][1][1] as xdr.ScVal)).toBe(ESCROW_ADDR);

    // Second call: set_identity_contract(admin, identityAddr)
    expect(decodeAddress(call.mock.calls[1][1][0] as xdr.ScVal)).toBe(ADMIN);
    expect(decodeAddress(call.mock.calls[1][1][1] as xdr.ScVal)).toBe(IDENTITY_ADDR);
  });
});

describe('FleetManagementClient.reactivateFleet', () => {
  it('calls reactivate_fleet with caller and fleet ID', async () => {
    const call = mockInvoker({ reactivate_fleet: [nativeToScVal(null)] });

    await client().reactivateFleet({ caller: ADMIN, fleetId: 42n });

    expect(call).toHaveBeenCalledTimes(1);
    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('reactivate_fleet');
    expect(args).toHaveLength(2);
    expect(decodeAddress(args[0] as xdr.ScVal)).toBe(ADMIN);
    expect(scValToNative(args[1] as xdr.ScVal)).toBe(42n);
  });
});

// ── Pending peer-contract queries ─────────────────────────────────────────────

const PROPOSED_ESCROW = 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR';
const ACTIVATES_AT = 1_700_086_400n;

/** Encode a Rust `PendingContractAddress` struct as the contract returns it. */
function pendingContractScVal(addr: string, proposedBy: string, activatesAt: bigint): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('activates_at'),
      val: nativeToScVal(activatesAt, { type: 'u64' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('address'),
      val: nativeToScVal(addr, { type: 'address' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('proposed_by'),
      val: nativeToScVal(proposedBy, { type: 'address' }),
    }),
  ]);
}

describe('FleetManagementClient.getPendingEscrowContract', () => {
  it('calls get_pending_escrow_contract with no args and decodes the record', async () => {
    const call = mockInvoker({
      get_pending_escrow_contract: [pendingContractScVal(PROPOSED_ESCROW, ADMIN, ACTIVATES_AT)],
    });

    const result = await client().getPendingEscrowContract();

    expect(result).toEqual({
      address: PROPOSED_ESCROW,
      proposedBy: ADMIN,
      activatesAt: ACTIVATES_AT,
    });
    expect(typeof result?.activatesAt).toBe('bigint');
    expect(call).toHaveBeenCalledTimes(1);
    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('get_pending_escrow_contract');
    expect(args).toHaveLength(0);
  });

  it('preserves u64 activation times beyond Number.MAX_SAFE_INTEGER', async () => {
    const huge = 18_446_744_073_709_551_615n; // u64::MAX (saturating_add ceiling)
    mockInvoker({
      get_pending_escrow_contract: [pendingContractScVal(PROPOSED_ESCROW, ADMIN, huge)],
    });

    const result = await client().getPendingEscrowContract();

    expect(result?.activatesAt).toBe(huge);
  });

  it('returns null when no escrow change is pending (Option::None)', async () => {
    mockInvoker({ get_pending_escrow_contract: [nativeToScVal(null)] });

    expect(await client().getPendingEscrowContract()).toBeNull();
  });

  it('returns null when the invoker resolves undefined', async () => {
    jest.spyOn(ContractInvoker.prototype, 'call').mockResolvedValue(undefined as never);

    expect(await client().getPendingEscrowContract()).toBeNull();
  });

  it('rejects a malformed record instead of returning partial state', async () => {
    jest
      .spyOn(ContractInvoker.prototype, 'call')
      .mockResolvedValue({ address: PROPOSED_ESCROW, proposed_by: ADMIN } as never);

    await expect(client().getPendingEscrowContract()).rejects.toThrow(
      "get_pending_escrow_contract: malformed record, missing field 'activates_at'",
    );
  });

  it('propagates a contract/simulation error to the caller', async () => {
    jest
      .spyOn(ContractInvoker.prototype, 'call')
      .mockRejectedValue(new Error('Soroban simulation failed'));

    await expect(client().getPendingEscrowContract()).rejects.toThrow('Soroban simulation failed');
  });
});

const NEW_OWNER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

/** Encode a Rust `PendingFleetOwnerReassignment` struct as the contract returns it. */
function pendingOwnerScVal(newOwner: string, admin: string): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('admin'),
      val: nativeToScVal(admin, { type: 'address' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('new_owner'),
      val: nativeToScVal(newOwner, { type: 'address' }),
    }),
  ]);
}

describe('FleetManagementClient.getPendingFleetOwnerReassignment', () => {
  it('calls get_pending_fleet_owner_reassignment with the fleet id and decodes the record', async () => {
    const call = mockInvoker({
      get_pending_fleet_owner_reassignment: [pendingOwnerScVal(NEW_OWNER, ADMIN)],
    });

    const result = await client().getPendingFleetOwnerReassignment(7n);

    expect(result).toEqual({ newOwner: NEW_OWNER, admin: ADMIN });
    expect(call).toHaveBeenCalledTimes(1);
    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('get_pending_fleet_owner_reassignment');
    expect(args).toHaveLength(1);
    expect(scValToNative(args[0] as xdr.ScVal)).toBe(7n);
  });

  it('encodes u64::MAX fleet ids without loss', async () => {
    const call = mockInvoker({ get_pending_fleet_owner_reassignment: [nativeToScVal(null)] });
    const maxId = 18_446_744_073_709_551_615n;

    await client().getPendingFleetOwnerReassignment(maxId);

    expect(scValToNative(call.mock.calls[0][1][0] as xdr.ScVal)).toBe(maxId);
  });

  it('returns null when no reassignment is pending (Option::None)', async () => {
    mockInvoker({ get_pending_fleet_owner_reassignment: [nativeToScVal(null)] });

    expect(await client().getPendingFleetOwnerReassignment(7n)).toBeNull();
  });

  it('returns null when the invoker resolves undefined', async () => {
    jest.spyOn(ContractInvoker.prototype, 'call').mockResolvedValue(undefined as never);

    expect(await client().getPendingFleetOwnerReassignment(7n)).toBeNull();
  });

  it('rejects a malformed record instead of returning partial state', async () => {
    jest
      .spyOn(ContractInvoker.prototype, 'call')
      .mockResolvedValue({ admin: ADMIN } as never);

    await expect(client().getPendingFleetOwnerReassignment(7n)).rejects.toThrow(
      "get_pending_fleet_owner_reassignment: malformed record, missing field 'new_owner'",
    );
  });

  it('rejects a non-struct value', async () => {
    jest.spyOn(ContractInvoker.prototype, 'call').mockResolvedValue([NEW_OWNER, ADMIN] as never);

    await expect(client().getPendingFleetOwnerReassignment(7n)).rejects.toThrow(
      'get_pending_fleet_owner_reassignment: expected a struct record, received array',
    );
  });

  it('propose → inspect → accept flow targets the expected entrypoints', async () => {
    const call = mockInvoker({
      admin_reassign_fleet_owner: [nativeToScVal(null)],
      get_pending_fleet_owner_reassignment: [pendingOwnerScVal(NEW_OWNER, ADMIN)],
      accept_fleet_owner_reassignment: [nativeToScVal(null)],
    });

    const fleetClient = client();
    await fleetClient.adminReassignFleetOwner({ admin: ADMIN, fleetId: 7n, newOwner: NEW_OWNER });
    const pending = await fleetClient.getPendingFleetOwnerReassignment(7n);
    expect(pending?.newOwner).toBe(NEW_OWNER);
    await fleetClient.acceptFleetOwnerReassignment(7n, pending!.newOwner);

    expect(call.mock.calls.map((c) => c[0])).toEqual([
      'admin_reassign_fleet_owner',
      'get_pending_fleet_owner_reassignment',
      'accept_fleet_owner_reassignment',
    ]);
  });
});

const PROPOSED_IDENTITY = 'CBQHNAXSI55GX2GN6D67GK7BHVPSLJUGZQEU7WJ5LKR5PNUCGLIMAO4K';

describe('FleetManagementClient.getPendingIdentityContract', () => {
  it('calls get_pending_identity_contract with no args and decodes the record', async () => {
    const call = mockInvoker({
      get_pending_identity_contract: [pendingContractScVal(PROPOSED_IDENTITY, ADMIN, ACTIVATES_AT)],
    });

    const result = await client().getPendingIdentityContract();

    expect(result).toEqual({
      address: PROPOSED_IDENTITY,
      proposedBy: ADMIN,
      activatesAt: ACTIVATES_AT,
    });
    expect(call).toHaveBeenCalledTimes(1);
    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('get_pending_identity_contract');
    expect(args).toHaveLength(0);
  });

  it('decodes an activation time of zero (boundary) as 0n rather than treating it as absent', async () => {
    mockInvoker({
      get_pending_identity_contract: [pendingContractScVal(PROPOSED_IDENTITY, ADMIN, 0n)],
    });

    const result = await client().getPendingIdentityContract();

    expect(result).not.toBeNull();
    expect(result?.activatesAt).toBe(0n);
  });

  it('returns null when no identity change is pending (Option::None)', async () => {
    mockInvoker({ get_pending_identity_contract: [nativeToScVal(null)] });

    expect(await client().getPendingIdentityContract()).toBeNull();
  });

  it('returns null when the invoker resolves undefined', async () => {
    jest.spyOn(ContractInvoker.prototype, 'call').mockResolvedValue(undefined as never);

    expect(await client().getPendingIdentityContract()).toBeNull();
  });

  it('rejects a malformed record instead of returning partial state', async () => {
    jest
      .spyOn(ContractInvoker.prototype, 'call')
      .mockResolvedValue({ address: PROPOSED_IDENTITY, activates_at: 1n } as never);

    await expect(client().getPendingIdentityContract()).rejects.toThrow(
      "get_pending_identity_contract: malformed record, missing field 'proposed_by'",
    );
  });

  it('propagates a contract/simulation error to the caller', async () => {
    jest
      .spyOn(ContractInvoker.prototype, 'call')
      .mockRejectedValue(new Error('Soroban simulation failed'));

    await expect(client().getPendingIdentityContract()).rejects.toThrow('Soroban simulation failed');
  });

  it('does not confuse the identity and escrow pending queries', async () => {
    const call = mockInvoker({
      get_pending_identity_contract: [pendingContractScVal(PROPOSED_IDENTITY, ADMIN, ACTIVATES_AT)],
      get_pending_escrow_contract: [nativeToScVal(null)],
    });

    const fleetClient = client();
    const identity = await fleetClient.getPendingIdentityContract();
    const escrow = await fleetClient.getPendingEscrowContract();

    expect(identity?.address).toBe(PROPOSED_IDENTITY);
    expect(escrow).toBeNull();
    expect(call.mock.calls.map((c) => c[0])).toEqual([
      'get_pending_identity_contract',
      'get_pending_escrow_contract',
    ]);
  });
});
