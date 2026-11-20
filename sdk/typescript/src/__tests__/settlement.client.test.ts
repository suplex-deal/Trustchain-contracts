import fs from 'fs';
import path from 'path';

import { nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';

import { SettlementClient } from '../clients/settlement.client';
import { ContractInvoker } from '../clients/invoker';

/**
 * SettlementClient reaches the chain exclusively through `ContractInvoker.call`,
 * so a test double at that seam exercises the real argument encoding in
 * `clients/invoker.ts` while asserting the exact contract function name each
 * binding targets. Return values are queued per contract function as raw ScVals
 * and decoded the same way `ContractInvoker.call` decodes them.
 */
function mockInvoker(retvals: Record<string, xdr.ScVal[]>): jest.SpyInstance {
  const call = jest.fn(async (functionName: string, args: xdr.ScVal[]) => {
    const queue = retvals[functionName];
    if (!queue || queue.length === 0) {
      return undefined;
    }
    const value = queue.length === 1 ? queue[0] : queue.shift();
    return value === undefined ? undefined : scValToNative(value as xdr.ScVal);
  });
  jest.spyOn(ContractInvoker.prototype, 'call').mockImplementation(call as never);
  return call;
}

// Deterministic placeholder addresses — the invoker is mocked, so only the
// address *encoding* matters, but they must be structurally valid so the
// `Contract`/`Address` constructors in clients/invoker.ts accept them.
const CONTRACT_ID = 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR';
const ADMIN = 'GAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSH7S';
const DRIVER = 'GAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSH7S';
const TOKEN = 'GAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSH7S';

function client(): SettlementClient {
  return new SettlementClient(CONTRACT_ID);
}

function decodeAddress(value: xdr.ScVal): string {
  return scValToNative(value) as string;
}

/** Discriminant name of an ScVal, e.g. `scvAddress` or `scvU64`. */
function scValType(value: xdr.ScVal): string {
  return (value as unknown as { type: string }).type;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('SettlementClient init', () => {
  it('constructs with the given contract id', () => {
    const settlement = client();
    expect(settlement).toBeInstanceOf(SettlementClient);
  });

  it('does not touch the chain on construction', () => {
    const call = jest.spyOn(ContractInvoker.prototype, 'call');
    client();
    expect(call).not.toHaveBeenCalled();
  });
});

describe('SettlementClient getAdmin', () => {
  it('reads get_admin and decodes the admin address', async () => {
    const call = mockInvoker({ get_admin: [nativeToScVal(ADMIN, { type: 'address' })] });

    const admin = await client().getAdmin();

    expect(admin).toBe(ADMIN);
    expect(call).toHaveBeenCalledTimes(1);
    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('get_admin');
    expect(args).toHaveLength(0);
  });
});

describe('SettlementClient setDriverPreference', () => {
  it('targets set_driver_preference with driver and token args', async () => {
    const call = mockInvoker({ set_driver_preference: [nativeToScVal(null)] });

    await client().setDriverPreference({ driver: DRIVER, toToken: TOKEN });

    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('set_driver_preference');
    expect(args).toHaveLength(2);
    expect(decodeAddress(args[0] as xdr.ScVal)).toBe(DRIVER);
    expect(decodeAddress(args[1] as xdr.ScVal)).toBe(TOKEN);
  });

  it('propagates a reverted preference update to the caller', async () => {
    jest
      .spyOn(ContractInvoker.prototype, 'call')
      .mockRejectedValue(new Error('Soroban simulation failed: TrustchainError::Unauthorized'));

    await expect(
      client().setDriverPreference({ driver: DRIVER, toToken: TOKEN }),
    ).rejects.toThrow('Unauthorized');
  });
});

describe('SettlementClient getDriverPreference', () => {
  it('reads get_driver_preference with the driver address', async () => {
    const call = mockInvoker({
      get_driver_preference: [nativeToScVal(TOKEN, { type: 'address' })],
    });

    const preference = await client().getDriverPreference(DRIVER);

    expect(preference).toBe(TOKEN);
    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('get_driver_preference');
    expect(args).toHaveLength(1);
    expect(decodeAddress(args[0] as xdr.ScVal)).toBe(DRIVER);
  });

  it('returns null when no preference is set', async () => {
    mockInvoker({ get_driver_preference: [nativeToScVal(null)] });

    await expect(client().getDriverPreference(DRIVER)).resolves.toBeNull();
  });
});

describe('SettlementClient clearDriverPreference', () => {
  it('targets clear_driver_preference with only the driver address', async () => {
    const call = mockInvoker({ clear_driver_preference: [nativeToScVal(null)] });

    await expect(client().clearDriverPreference(DRIVER)).resolves.toBeUndefined();

    expect(call).toHaveBeenCalledTimes(1);
    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('clear_driver_preference');
    expect(args).toHaveLength(1);
    expect(decodeAddress(args[0] as xdr.ScVal)).toBe(DRIVER);
  });

  it('propagates a rejected clear (e.g. missing driver auth) to the caller', async () => {
    jest
      .spyOn(ContractInvoker.prototype, 'call')
      .mockRejectedValue(new Error('Soroban simulation failed: Error(Auth, InvalidAction)'));

    await expect(client().clearDriverPreference(DRIVER)).rejects.toThrow('Auth');
  });

  it('rejects a malformed driver address before touching the chain', async () => {
    const call = mockInvoker({});

    await expect(client().clearDriverPreference('not-an-address')).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });

  it('round-trips set -> clear -> get back to null', async () => {
    const call = mockInvoker({ get_driver_preference: [nativeToScVal(null)] });
    const settlement = client();

    await settlement.setDriverPreference({ driver: DRIVER, toToken: TOKEN });
    await settlement.clearDriverPreference(DRIVER);
    await expect(settlement.getDriverPreference(DRIVER)).resolves.toBeNull();

    expect(call.mock.calls.map(([fn]) => fn)).toEqual([
      'set_driver_preference',
      'clear_driver_preference',
      'get_driver_preference',
    ]);
  });
});

describe('SettlementClient executeSettlementSwap', () => {
  const DEADLINE = 1_700_000_300n;
  const swapParams = {
    caller: ADMIN,
    fromToken: TOKEN,
    toToken: TOKEN,
    recipient: DRIVER,
    amount: 1_000n,
    minAmountOut: 950n,
    deadline: DEADLINE,
  };

  it('targets execute_settlement_swap with all seven args, deadline last as u64', async () => {
    const call = mockInvoker({ execute_settlement_swap: [nativeToScVal(null)] });

    await client().executeSettlementSwap(swapParams);

    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('execute_settlement_swap');
    expect(args).toHaveLength(7);
    expect(decodeAddress(args[0] as xdr.ScVal)).toBe(ADMIN);
    expect(decodeAddress(args[1] as xdr.ScVal)).toBe(TOKEN);
    expect(decodeAddress(args[2] as xdr.ScVal)).toBe(TOKEN);
    expect(decodeAddress(args[3] as xdr.ScVal)).toBe(DRIVER);
    expect(scValToNative(args[4] as xdr.ScVal)).toBe(1_000n);
    expect(scValToNative(args[5] as xdr.ScVal)).toBe(950n);
    const deadline = args[6] as xdr.ScVal;
    expect(scValType(deadline)).toBe('scvU64');
    expect(scValToNative(deadline)).toBe(DEADLINE);
  });

  it('propagates a reverted swap (e.g. InvalidSwapDeadline) to the caller', async () => {
    jest
      .spyOn(ContractInvoker.prototype, 'call')
      .mockRejectedValue(new Error('Soroban simulation failed: SettlementError::InvalidSwapDeadline'));

    await expect(client().executeSettlementSwap(swapParams)).rejects.toThrow('InvalidSwapDeadline');
  });

  it('encodes the u64 boundaries 0 and 2^64 - 1 exactly', async () => {
    const call = mockInvoker({});
    for (const deadline of [0n, 2n ** 64n - 1n]) {
      await client().executeSettlementSwap({ ...swapParams, deadline });
    }
    expect(call.mock.calls.map(([, args]) => scValToNative(args[6] as xdr.ScVal))).toEqual([
      0n,
      2n ** 64n - 1n,
    ]);
  });

  it.each([-1n, 2n ** 64n])('rejects out-of-range deadline %s before touching the chain', async (deadline) => {
    const call = mockInvoker({});

    await expect(client().executeSettlementSwap({ ...swapParams, deadline })).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
});

/**
 * Parity with the on-chain signatures: every SettlementClient method must send
 * exactly the arguments, in order and ScVal type, that the matching `pub fn`
 * in contracts/settlement_contract/lib.rs declares. This catches drift like a
 * newly added contract parameter that the SDK never serializes.
 */
describe('SettlementClient parity with settlement_contract signatures', () => {
  const CONTRACT_PATH = path.resolve(__dirname, '../../../../contracts/settlement_contract/lib.rs');
  const RUST_TO_SCVAL: Record<string, string> = {
    Address: 'scvAddress',
    i128: 'scvI128',
    u64: 'scvU64',
    u32: 'scvU32',
    bool: 'scvBool',
  };

  function contractParams(fnName: string): Array<{ name: string; scType: string }> {
    const src = fs.readFileSync(CONTRACT_PATH, 'utf8');
    const match = new RegExp(`pub fn ${fnName}\\s*\\(([^)]*)\\)`).exec(src);
    if (!match) {
      throw new Error(`pub fn ${fnName} not found in settlement_contract/lib.rs`);
    }
    return match[1]
      .split(',')
      .map((param) => param.trim())
      .filter((param) => param && !/:\s*Env$/.test(param))
      .map((param) => {
        const [name, rustType] = param.split(':').map((part) => part.trim());
        const scType = RUST_TO_SCVAL[rustType];
        if (!scType) {
          throw new Error(`No ScVal mapping for Rust type ${rustType} (${fnName}.${name})`);
        }
        return { name, scType };
      });
  }

  const cases: Array<[string, (c: SettlementClient) => Promise<unknown>]> = [
    ['init', (c) => c.init({ admin: ADMIN, escrowContract: CONTRACT_ID })],
    ['get_admin', (c) => c.getAdmin()],
    ['get_driver_preference', (c) => c.getDriverPreference(DRIVER)],
    ['set_driver_preference', (c) => c.setDriverPreference({ driver: DRIVER, toToken: TOKEN })],
    ['clear_driver_preference', (c) => c.clearDriverPreference(DRIVER)],
    [
      'execute_settlement_swap',
      (c) =>
        c.executeSettlementSwap({
          caller: ADMIN,
          fromToken: TOKEN,
          toToken: TOKEN,
          recipient: DRIVER,
          amount: 1n,
          minAmountOut: 1n,
          deadline: 1n,
        }),
    ],
  ];

  it.each(cases)('%s arguments match the contract signature', async (fnName, invoke) => {
    const call = mockInvoker({});

    await invoke(client());

    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe(fnName);
    expect((args as xdr.ScVal[]).map(scValType)).toEqual(
      contractParams(fnName).map((param) => param.scType),
    );
  });

  it('execute_settlement_swap declares deadline: u64 as its final parameter', () => {
    const params = contractParams('execute_settlement_swap');
    expect(params[params.length - 1]).toEqual({ name: 'deadline', scType: 'scvU64' });
  });
});
