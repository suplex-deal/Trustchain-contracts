import fs from 'fs';
import path from 'path';
import { nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';

import { EscrowClient } from '../clients/escrow.client';
import { ContractInvoker } from '../clients/invoker';
import {
  EscrowErrorCodes,
  MAX_SLIPPAGE_TOLERANCE_BPS,
  SUPPORTED_PROTOCOL_VERSION,
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

describe('EscrowClient getProtocolVersion', () => {
  it('reads get_protocol_version and decodes a u32 as number', async () => {
    const call = mockInvoker({ get_protocol_version: nativeToScVal(1, { type: 'u32' }) });

    await expect(client().getProtocolVersion()).resolves.toBe(1);
    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('get_protocol_version');
    expect(args).toHaveLength(0);
  });
});

describe('EscrowClient slippage tolerance', () => {
  it('getSlippageTolerance reads get_slippage_tolerance', async () => {
    const call = mockInvoker({ get_slippage_tolerance: nativeToScVal(250, { type: 'u32' }) });

    await expect(client().getSlippageTolerance()).resolves.toBe(250);
    expect(call.mock.calls[0][0]).toBe('get_slippage_tolerance');
  });

  it('updateSlippageTolerance targets update_slippage_tolerance with (admin, u32 bps)', async () => {
    const call = mockInvoker({});

    await client().updateSlippageTolerance({ admin: ADMIN, newSlippageBps: 250 });

    const [fn, args] = call.mock.calls[0];
    expect(fn).toBe('update_slippage_tolerance');
    expect(args).toHaveLength(2);
    expect(decode(args[0])).toBe(ADMIN);
    expect((args[1] as xdr.ScVal).toXDR('base64')).toBe(
      nativeToScVal(250, { type: 'u32' }).toXDR('base64'),
    );
  });

  it.each([
    ['zero', 0],
    ['the maximum', MAX_SLIPPAGE_TOLERANCE_BPS],
  ])('accepts %s (bounds are inclusive)', async (_label, newSlippageBps) => {
    const call = mockInvoker({});
    await client().updateSlippageTolerance({ admin: ADMIN, newSlippageBps });
    expect(decode(call.mock.calls[0][1][1])).toBe(newSlippageBps);
  });

  it.each([
    ['one above the maximum', MAX_SLIPPAGE_TOLERANCE_BPS + 1],
    ['a negative value', -1],
    ['a fractional value', 12.5],
    ['NaN', Number.NaN],
  ])('rejects %s locally without invoking the contract', async (_label, newSlippageBps) => {
    const call = mockInvoker({});
    await expect(
      client().updateSlippageTolerance({ admin: ADMIN, newSlippageBps }),
    ).rejects.toThrow(RangeError);
    expect(call).not.toHaveBeenCalled();
  });

  it('surfaces an Unauthorized revert for a non-admin caller', async () => {
    jest
      .spyOn(ContractInvoker.prototype, 'call')
      .mockRejectedValue(new Error('Soroban simulation failed: TrustchainError::Unauthorized'));

    await expect(
      client().updateSlippageTolerance({ admin: ADMIN, newSlippageBps: 100 }),
    ).rejects.toThrow('Unauthorized');
  });
});

describe('protocol configuration parity with contracts/escrow_contract', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../../contracts/escrow_contract/lib.rs'),
    'utf8',
  );

  function rustU32(name: string): number {
    const match = src.match(new RegExp(`pub const ${name}: u32 = ([0-9_]+);`));
    if (!match) throw new Error(`${name} not found in escrow_contract/lib.rs`);
    return Number(match[1].replace(/_/g, ''));
  }

  it('SUPPORTED_PROTOCOL_VERSION matches PROTOCOL_VERSION', () => {
    expect(SUPPORTED_PROTOCOL_VERSION).toBe(rustU32('PROTOCOL_VERSION'));
  });

  it('MAX_SLIPPAGE_TOLERANCE_BPS matches the contract bound', () => {
    expect(MAX_SLIPPAGE_TOLERANCE_BPS).toBe(rustU32('MAX_SLIPPAGE_TOLERANCE_BPS'));
  });

  it('InvalidSlippageTolerance error code matches EscrowError', () => {
    const match = src.match(/InvalidSlippageTolerance = (\d+),/);
    expect(match).not.toBeNull();
    expect(EscrowErrorCodes.InvalidSlippageTolerance).toBe(Number(match![1]));
  });

  it.each(['get_protocol_version', 'get_slippage_tolerance', 'update_slippage_tolerance'])(
    'contract still exposes %s',
    (fn) => {
      expect(src).toMatch(new RegExp(`pub fn ${fn}\\(`));
    },
  );
});
