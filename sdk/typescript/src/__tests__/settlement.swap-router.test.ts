import { nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';

import { SettlementClient } from '../clients/settlement.client';
import { ContractInvoker } from '../clients/invoker';

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
const ROUTER = 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR';

const client = () => new SettlementClient(CONTRACT_ID);
const decode = (v: unknown) => scValToNative(v as xdr.ScVal);

afterEach(() => jest.restoreAllMocks());

describe('SettlementClient setSwapRouter', () => {
  it('targets set_swap_router with (admin, router)', async () => {
    const call = mockInvoker({});

    await client().setSwapRouter({ admin: ADMIN, router: ROUTER });

    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('set_swap_router');
    expect(args).toHaveLength(2);
    expect(decode(args[0])).toBe(ADMIN);
    expect(decode(args[1])).toBe(ROUTER);
  });

  it('surfaces an Unauthorized revert when the caller is not the admin', async () => {
    jest
      .spyOn(ContractInvoker.prototype, 'call')
      .mockRejectedValue(new Error('Soroban simulation failed: TrustchainError::Unauthorized'));

    await expect(client().setSwapRouter({ admin: ADMIN, router: ROUTER })).rejects.toThrow('Unauthorized');
  });

  it.each([
    ['an account (G...) address', ADMIN],
    ['a malformed string', 'not-an-address'],
    ['an empty string', ''],
  ])('rejects %s as the router without invoking the contract', async (_label, router) => {
    const call = mockInvoker({});

    await expect(client().setSwapRouter({ admin: ADMIN, router })).rejects.toThrow(TypeError);
    expect(call).not.toHaveBeenCalled();
  });
});

describe('SettlementClient getSwapRouter', () => {
  it('reads get_swap_router and returns the configured router', async () => {
    const call = mockInvoker({ get_swap_router: nativeToScVal(ROUTER, { type: 'address' }) });

    await expect(client().getSwapRouter()).resolves.toBe(ROUTER);
    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('get_swap_router');
    expect(args).toHaveLength(0);
  });

  it('returns null when no router is configured', async () => {
    mockInvoker({ get_swap_router: nativeToScVal(null) });
    await expect(client().getSwapRouter()).resolves.toBeNull();
  });
});
