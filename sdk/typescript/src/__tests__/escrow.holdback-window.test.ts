import fs from 'fs';
import path from 'path';
import { nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';

import { EscrowClient } from '../clients/escrow.client';
import { ContractInvoker } from '../clients/invoker';
import {
  DEFAULT_HOLDBACK_WINDOW_SECONDS,
  MAX_HOLDBACK_WINDOW_SECONDS,
  MIN_HOLDBACK_WINDOW_SECONDS,
} from '../types/escrow.types';

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

const client = () => new EscrowClient(CONTRACT_ID);
const decode = (v: unknown) => scValToNative(v as xdr.ScVal);

afterEach(() => jest.restoreAllMocks());

describe('EscrowClient setHoldbackWindow', () => {
  it('targets set_holdback_window with (admin, u64 seconds)', async () => {
    const call = mockInvoker({});

    await client().setHoldbackWindow({ admin: ADMIN, windowSeconds: 7 * 86_400 });

    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('set_holdback_window');
    expect(args).toHaveLength(2);
    expect(decode(args[0])).toBe(ADMIN);
    expect((args[1] as xdr.ScVal).toXDR('base64')).toBe(
      nativeToScVal(604_800n, { type: 'u64' }).toXDR('base64'),
    );
  });

  it.each([
    ['the minimum', MIN_HOLDBACK_WINDOW_SECONDS],
    ['the maximum', MAX_HOLDBACK_WINDOW_SECONDS],
  ])('accepts %s (bounds are inclusive)', async (_label, windowSeconds) => {
    const call = mockInvoker({});
    await client().setHoldbackWindow({ admin: ADMIN, windowSeconds });
    expect(decode(call.mock.calls[0][1][1])).toBe(windowSeconds);
  });

  it.each([
    ['one second below the minimum', MIN_HOLDBACK_WINDOW_SECONDS - 1n],
    ['one second above the maximum', MAX_HOLDBACK_WINDOW_SECONDS + 1n],
    ['zero', 0n],
    ['a negative value', -1],
    ['a fractional number', 86_400.5],
  ])('rejects %s locally without invoking the contract', async (_label, windowSeconds) => {
    const call = mockInvoker({});
    await expect(client().setHoldbackWindow({ admin: ADMIN, windowSeconds })).rejects.toThrow(RangeError);
    expect(call).not.toHaveBeenCalled();
  });

  it('surfaces an Unauthorized revert for a non-admin caller', async () => {
    jest
      .spyOn(ContractInvoker.prototype, 'call')
      .mockRejectedValue(new Error('Soroban simulation failed: TrustchainError::Unauthorized'));

    await expect(
      client().setHoldbackWindow({ admin: ADMIN, windowSeconds: MIN_HOLDBACK_WINDOW_SECONDS }),
    ).rejects.toThrow('Unauthorized');
  });
});

describe('EscrowClient getHoldbackWindow', () => {
  it('reads get_holdback_window and decodes a u64 as bigint', async () => {
    const call = mockInvoker({
      get_holdback_window: nativeToScVal(DEFAULT_HOLDBACK_WINDOW_SECONDS, { type: 'u64' }),
    });

    await expect(client().getHoldbackWindow()).resolves.toBe(DEFAULT_HOLDBACK_WINDOW_SECONDS);
    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('get_holdback_window');
    expect(args).toHaveLength(0);
  });
});

describe('holdback window constants match contracts/escrow_contract', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../../contracts/escrow_contract/lib.rs'),
    'utf8',
  );

  /** Evaluate a `pub const NAME: u64 = a * b * ...;` product expression. */
  function rustU64(name: string): bigint {
    const match = src.match(new RegExp(`pub const ${name}: u64 = ([0-9_ *]+);`));
    if (!match) throw new Error(`${name} not found in escrow_contract/lib.rs`);
    return match[1]
      .split('*')
      .map((part) => BigInt(part.trim().replace(/_/g, '')))
      .reduce((a, b) => a * b, 1n);
  }

  it.each([
    ['DEFAULT_HOLDBACK_WINDOW_SECONDS', DEFAULT_HOLDBACK_WINDOW_SECONDS],
    ['MIN_HOLDBACK_WINDOW_SECONDS', MIN_HOLDBACK_WINDOW_SECONDS],
    ['MAX_HOLDBACK_WINDOW_SECONDS', MAX_HOLDBACK_WINDOW_SECONDS],
  ])('%s', (name, sdkValue) => {
    expect(sdkValue).toBe(rustU64(name));
  });
});
