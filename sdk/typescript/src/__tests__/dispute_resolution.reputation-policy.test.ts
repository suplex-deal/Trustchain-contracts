/**
 * Issue #54 — the dispute contract exposes three reputation policy controls
 * (primary penalty, pay-driver reward, split penalty). The typed client must
 * cover all three with the contract's shared `0..=MAX` bound.
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
import { MAX_DISPUTE_REPUTATION_ADJUSTMENT } from '../types/dispute_resolution.types';

const admin = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

type Setter = (client: DisputeResolutionClient, value: number) => Promise<void>;
type Getter = (client: DisputeResolutionClient) => Promise<number>;

const CONTROLS: Array<[string, string, string, Setter, Getter]> = [
  [
    'reputation penalty',
    'set_dispute_reputation_penalty',
    'get_dispute_reputation_penalty',
    (c, v) => c.setDisputeReputationPenalty({ caller: admin, penalty: v }),
    (c) => c.getDisputeReputationPenalty(),
  ],
  [
    'reputation reward',
    'set_dispute_reputation_reward',
    'get_dispute_reputation_reward',
    (c, v) => c.setDisputeReputationReward({ caller: admin, reward: v }),
    (c) => c.getDisputeReputationReward(),
  ],
  [
    'split penalty',
    'set_dispute_split_penalty',
    'get_dispute_split_penalty',
    (c, v) => c.setDisputeSplitPenalty({ caller: admin, penalty: v }),
    (c) => c.getDisputeSplitPenalty(),
  ],
];

describe('DisputeResolutionClient reputation policy controls', () => {
  let client: DisputeResolutionClient;
  let callMock: jest.Mock;

  beforeEach(() => {
    client = new DisputeResolutionClient('CDISPUTECONTRACTIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    callMock = jest.fn().mockResolvedValue(undefined);
    (client as unknown as { invoker: { call: jest.Mock } }).invoker = { call: callMock };
  });

  test('MAX_DISPUTE_REPUTATION_ADJUSTMENT matches the contract bound', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../../contracts/dispute_resolution_contract/lib.rs'),
      'utf8'
    );
    const identityMax = Number(/const IDENTITY_MAX_REPUTATION: u32 = (\d+);/.exec(src)?.[1]);
    expect(src).toMatch(/const MAX_DISPUTE_REPUTATION_PENALTY: u32 = IDENTITY_MAX_REPUTATION \/ 2;/);
    expect(MAX_DISPUTE_REPUTATION_ADJUSTMENT).toBe(Math.floor(identityMax / 2));
  });

  describe.each(CONTROLS)('%s', (_name, setFn, getFn, set, get) => {
    test.each([[0], [7], [MAX_DISPUTE_REPUTATION_ADJUSTMENT]])(
      'encodes in-range value %p as (address, u32)',
      async (value) => {
        await set(client, value);

        expect(callMock).toHaveBeenCalledWith(
          setFn,
          [
            { kind: 'address', value: admin },
            { kind: 'u32', value },
          ],
          undefined
        );
      }
    );

    test.each([[-1], [MAX_DISPUTE_REPUTATION_ADJUSTMENT + 1], [2.5], [Number.NaN]])(
      'rejects out-of-range value %p without submitting',
      async (value) => {
        await expect(set(client, value)).rejects.toThrow(RangeError);
        expect(callMock).not.toHaveBeenCalled();
      }
    );

    test('propagates a contract rejection (e.g. non-admin caller)', async () => {
      callMock.mockRejectedValue(new Error('TrustchainError.Unauthorized'));

      await expect(set(client, 1)).rejects.toThrow('Unauthorized');
    });

    test('getter reads the stored value as a number', async () => {
      callMock.mockResolvedValue(12);

      await expect(get(client)).resolves.toBe(12);
      expect(callMock).toHaveBeenCalledWith(getFn, [], undefined);
    });
  });
});
