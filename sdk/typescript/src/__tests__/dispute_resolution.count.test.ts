/**
 * Issue #55 — `getDisputeCount` exposes `get_dispute_count` so callers can
 * tell when `getDisputesPage` has walked the whole index without heuristics.
 */
jest.mock('../clients/invoker', () => ({
  address: (value: string) => ({ kind: 'address', value }),
  u64: (value: bigint | number) => ({ kind: 'u64', value: BigInt(value) }),
  u32: (value: number) => ({ kind: 'u32', value }),
  bytes: (value: Uint8Array) => ({ kind: 'bytes', value: Buffer.from(value) }),
  ContractInvoker: class {},
}));

import { DisputeResolutionClient } from '../clients/dispute_resolution.client';

describe('DisputeResolutionClient.getDisputeCount', () => {
  let client: DisputeResolutionClient;
  let callMock: jest.Mock;

  beforeEach(() => {
    client = new DisputeResolutionClient('CDISPUTECONTRACTIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
    callMock = jest.fn();
    (client as unknown as { invoker: { call: jest.Mock } }).invoker = { call: callMock };
  });

  test('invokes get_dispute_count with no arguments and decodes the u32', async () => {
    callMock.mockResolvedValue(7);

    await expect(client.getDisputeCount()).resolves.toBe(7);
    expect(callMock).toHaveBeenCalledWith('get_dispute_count', [], undefined);
  });

  test('returns 0 for an empty index', async () => {
    callMock.mockResolvedValue(0);

    await expect(client.getDisputeCount()).resolves.toBe(0);
  });

  test('accepts the u32 upper bound', async () => {
    callMock.mockResolvedValue(0xffffffff);

    await expect(client.getDisputeCount()).resolves.toBe(0xffffffff);
  });

  test.each([[-1], [1.5], [0x100000000], ['not-a-number']])(
    'rejects a non-u32 count %p',
    async (raw) => {
      callMock.mockResolvedValue(raw);

      await expect(client.getDisputeCount()).rejects.toThrow(TypeError);
    }
  );

  test('propagates RPC failures instead of reporting zero disputes', async () => {
    callMock.mockRejectedValue(new Error('rpc unavailable'));

    await expect(client.getDisputeCount()).rejects.toThrow('rpc unavailable');
  });

  test('count bounds pagination: every ID is read exactly once', async () => {
    const index = [1n, 2n, 3n, 4n, 5n];
    callMock.mockImplementation(async (fn: string, args: Array<{ value: number }>) => {
      if (fn === 'get_dispute_count') return index.length;
      if (fn === 'get_disputes_page') {
        const [offset, limit] = args.map((arg) => arg.value);
        return index.slice(offset, offset + limit);
      }
      throw new Error(`unexpected call ${fn}`);
    });

    const pageSize = 2;
    const count = await client.getDisputeCount();
    const seen: bigint[] = [];
    for (let page = 0; page * pageSize < count; page += 1) {
      seen.push(...(await client.getDisputesPage(page, pageSize)));
    }

    expect(seen).toEqual(index);
    const pageCalls = callMock.mock.calls.filter(([fn]) => fn === 'get_disputes_page');
    expect(pageCalls).toHaveLength(Math.ceil(count / pageSize));
  });

  test('an empty index requires no page reads', async () => {
    callMock.mockResolvedValueOnce(0);

    const count = await client.getDisputeCount();
    for (let page = 0; page * 10 < count; page += 1) {
      await client.getDisputesPage(page, 10);
    }

    expect(callMock).toHaveBeenCalledTimes(1);
  });
});
