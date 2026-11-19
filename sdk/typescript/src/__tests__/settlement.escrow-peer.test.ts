import { nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';

import { SettlementClient, isEscrowContractChangeReady } from '../clients/settlement.client';
import { ContractInvoker } from '../clients/invoker';
import { PEER_CONTRACT_CHANGE_TIMELOCK_SECONDS } from '../types/settlement.types';

/**
 * Escrow-peer rotation lifecycle on SettlementClient:
 *   proposeEscrowContract -> getPendingEscrowContract -> confirmEscrowContract
 *   -> getEscrowContract
 * The invoker is mocked at `ContractInvoker.call`, so the real ScVal encoding
 * is exercised and the exact contract function names are asserted.
 */
function mockInvoker(retvals: Record<string, xdr.ScVal>): jest.Mock {
  const call = jest.fn(async (functionName: string) => {
    const value = retvals[functionName];
    return value === undefined ? undefined : scValToNative(value);
  });
  jest.spyOn(ContractInvoker.prototype, 'call').mockImplementation(call as never);
  return call;
}

const CONTRACT_ID = 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR';
const ADMIN = 'GAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSH7S';
const NEW_ESCROW = 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR';
const ACTIVATES_AT = 1_800_000_000n;

const client = () => new SettlementClient(CONTRACT_ID);
const decode = (v: unknown) => scValToNative(v as xdr.ScVal);

afterEach(() => jest.restoreAllMocks());

describe('SettlementClient escrow-peer rotation', () => {
  it('proposeEscrowContract targets set_escrow_contract with (admin, newEscrow)', async () => {
    const call = mockInvoker({});

    await client().proposeEscrowContract({ admin: ADMIN, newEscrow: NEW_ESCROW });

    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('set_escrow_contract');
    expect(args).toHaveLength(2);
    expect(decode(args[0])).toBe(ADMIN);
    expect(decode(args[1])).toBe(NEW_ESCROW);
  });

  it('proposeEscrowContract rejects a malformed address before reaching the chain', async () => {
    const call = mockInvoker({});

    await expect(
      client().proposeEscrowContract({ admin: ADMIN, newEscrow: 'not-an-address' }),
    ).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });

  it('proposeEscrowContract surfaces an Unauthorized revert', async () => {
    jest
      .spyOn(ContractInvoker.prototype, 'call')
      .mockRejectedValue(new Error('Soroban simulation failed: TrustchainError::Unauthorized'));

    await expect(
      client().proposeEscrowContract({ admin: ADMIN, newEscrow: NEW_ESCROW }),
    ).rejects.toThrow('Unauthorized');
  });

  it('getPendingEscrowContract decodes the pending proposal', async () => {
    const call = mockInvoker({
      get_pending_escrow_contract: nativeToScVal(
        { address: NEW_ESCROW, proposed_by: ADMIN, activates_at: ACTIVATES_AT },
        { type: { address: ['symbol', 'address'], proposed_by: ['symbol', 'address'], activates_at: ['symbol', 'u64'] } },
      ),
    });

    const pending = await client().getPendingEscrowContract();

    expect(pending).toEqual({ address: NEW_ESCROW, proposedBy: ADMIN, activatesAt: ACTIVATES_AT });
    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('get_pending_escrow_contract');
    expect(args).toHaveLength(0);
  });

  it('getPendingEscrowContract returns null when no proposal is in flight', async () => {
    mockInvoker({ get_pending_escrow_contract: nativeToScVal(null) });
    await expect(client().getPendingEscrowContract()).resolves.toBeNull();
  });

  it('confirmEscrowContract targets confirm_escrow_contract with no args (permissionless)', async () => {
    const call = mockInvoker({});

    await client().confirmEscrowContract();

    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('confirm_escrow_contract');
    expect(args).toHaveLength(0);
  });

  it('confirmEscrowContract surfaces a timelock revert', async () => {
    jest
      .spyOn(ContractInvoker.prototype, 'call')
      .mockRejectedValue(
        new Error('Soroban simulation failed: TrustchainError::ContractChangeTimelockNotElapsed'),
      );

    await expect(client().confirmEscrowContract()).rejects.toThrow('ContractChangeTimelockNotElapsed');
  });

  it('getEscrowContract reads the active escrow peer', async () => {
    const call = mockInvoker({ get_escrow_contract: nativeToScVal(NEW_ESCROW, { type: 'address' }) });

    await expect(client().getEscrowContract()).resolves.toBe(NEW_ESCROW);
    expect(call.mock.calls[0][0]).toBe('get_escrow_contract');
  });
});

describe('isEscrowContractChangeReady timelock boundary', () => {
  const pending = { address: NEW_ESCROW, proposedBy: ADMIN, activatesAt: ACTIVATES_AT };

  it('is false one second before activation', () => {
    expect(isEscrowContractChangeReady(pending, ACTIVATES_AT - 1n)).toBe(false);
  });

  it('is true exactly at activation (contract checks now >= activates_at)', () => {
    expect(isEscrowContractChangeReady(pending, ACTIVATES_AT)).toBe(true);
  });

  it('is false when nothing is pending', () => {
    expect(isEscrowContractChangeReady(null, ACTIVATES_AT)).toBe(false);
  });

  it('timelock constant is three days', () => {
    expect(PEER_CONTRACT_CHANGE_TIMELOCK_SECONDS).toBe(3n * 24n * 60n * 60n);
  });
});
