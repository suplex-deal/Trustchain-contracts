/**
 * Issue #53 — the typed client must expose the full propose / pending /
 * confirm route for replacing the dispute contract's delivery and escrow
 * peers, so SDK-driven governance can complete a rotation.
 */
import fs from 'fs';
import path from 'path';

jest.mock('../clients/invoker', () => ({
  address: (value: string) => ({ kind: 'address', value }),
  u64: (value: bigint | number) => ({ kind: 'u64', value: BigInt(value) }),
  u32: (value: number) => ({ kind: 'u32', value }),
  bytes: (value: Uint8Array) => ({ kind: 'bytes', value: Buffer.from(value) }),
  ContractInvoker: class {},
}));

import { DisputeResolutionClient } from '../clients/dispute_resolution.client';

const admin = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const newPeer = 'CNEWPEERCONTRACTXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

const PEERS = [
  {
    peer: 'delivery',
    setFn: 'set_delivery_contract',
    confirmFn: 'confirm_delivery_contract',
    pendingFn: 'get_pending_delivery_contract',
    set: (c: DisputeResolutionClient) => c.setDeliveryContract({ caller: admin, deliveryContract: newPeer }),
    confirm: (c: DisputeResolutionClient) => c.confirmDeliveryContract(),
    pending: (c: DisputeResolutionClient) => c.getPendingDeliveryContract(),
  },
  {
    peer: 'escrow',
    setFn: 'set_escrow_contract',
    confirmFn: 'confirm_escrow_contract',
    pendingFn: 'get_pending_escrow_contract',
    set: (c: DisputeResolutionClient) => c.setEscrowContract({ caller: admin, escrowContract: newPeer }),
    confirm: (c: DisputeResolutionClient) => c.confirmEscrowContract(),
    pending: (c: DisputeResolutionClient) => c.getPendingEscrowContract(),
  },
];

describe('DisputeResolutionClient peer rotation', () => {
  let client: DisputeResolutionClient;
  let callMock: jest.Mock;

  beforeEach(() => {
    client = new DisputeResolutionClient('CDISPUTECONTRACTIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    callMock = jest.fn().mockResolvedValue(undefined);
    (client as unknown as { invoker: { call: jest.Mock } }).invoker = { call: callMock };
  });

  test('every wrapped entrypoint exists on the contract', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../../contracts/dispute_resolution_contract/lib.rs'),
      'utf8'
    );
    for (const { setFn, confirmFn, pendingFn } of PEERS) {
      for (const fn of [setFn, confirmFn, pendingFn]) {
        expect(src).toMatch(new RegExp(`pub fn ${fn}\\(`));
      }
    }
  });

  describe.each(PEERS)('$peer peer', ({ setFn, confirmFn, pendingFn, set, confirm, pending }) => {
    test('propose encodes (caller, new contract)', async () => {
      await set(client);

      expect(callMock).toHaveBeenCalledWith(
        setFn,
        [
          { kind: 'address', value: admin },
          { kind: 'address', value: newPeer },
        ],
        undefined
      );
    });

    test('confirm takes no arguments', async () => {
      await confirm(client);

      expect(callMock).toHaveBeenCalledWith(confirmFn, [], undefined);
    });

    test('pending decodes the proposal with a bigint activation time', async () => {
      callMock.mockResolvedValue({
        address: newPeer,
        proposed_by: admin,
        activates_at: 1_700_259_200n,
      });

      await expect(pending(client)).resolves.toEqual({
        address: newPeer,
        proposedBy: admin,
        activatesAt: 1_700_259_200n,
      });
      expect(callMock).toHaveBeenCalledWith(pendingFn, [], undefined);
    });

    test.each([[null], [undefined]])('pending returns null when nothing is proposed (%p)', async (raw) => {
      callMock.mockResolvedValue(raw);

      await expect(pending(client)).resolves.toBeNull();
    });

    test('propose propagates an Unauthorized rejection', async () => {
      callMock.mockRejectedValue(new Error('TrustchainError.Unauthorized'));

      await expect(set(client)).rejects.toThrow('Unauthorized');
    });

    test('confirm before the timelock propagates the contract error', async () => {
      callMock.mockRejectedValue(new Error('ContractChangeTimelockNotElapsed'));

      await expect(confirm(client)).rejects.toThrow('ContractChangeTimelockNotElapsed');
    });
  });
});
