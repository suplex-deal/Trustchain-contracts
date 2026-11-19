/**
 * Issue #52 — DeliveryClient exposes the peer-only dispute state operations
 * (`sync_dispute_from_escrow`, `resolve_dispute`) so integration automation
 * can call and inspect them through typed bindings.
 */
import fs from 'fs';
import path from 'path';

jest.mock('./invoker', () => ({
  ContractInvoker: jest.fn().mockImplementation(() => ({ call: jest.fn() })),
  address: (value: string) => ({ kind: 'address', value }),
  bool: (value: boolean) => value,
  map: (fields: Array<[string, unknown]>) => Object.fromEntries(fields),
  string: (value: string) => value,
  symbol: (value: string) => value,
  u32: (value: number) => value,
  u64: (value: bigint | number) => ({ kind: 'u64', value: BigInt(value) }),
}));

import { DeliveryClient } from './delivery.client';

const ESCROW_CONTRACT = 'C' + 'A'.repeat(55);
const DISPUTE_CONTRACT = 'C' + 'B'.repeat(55);
const ADMIN_ACCOUNT = 'G' + 'C'.repeat(55);

function getCall(client: DeliveryClient): jest.Mock {
  const invoker = Reflect.get(client, 'invoker') as object;
  return Reflect.get(invoker, 'call') as jest.Mock;
}

describe('DeliveryClient peer dispute operations', () => {
  let client: DeliveryClient;
  let call: jest.Mock;

  beforeEach(() => {
    client = new DeliveryClient('CDELIVERY');
    call = getCall(client);
    call.mockResolvedValue(undefined);
  });

  test('both wrapped entrypoints exist on the delivery contract', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../../../contracts/delivery_contract/lib.rs'),
      'utf8'
    );
    expect(src).toMatch(/pub fn sync_dispute_from_escrow\(\s*env: Env,\s*caller: Address,\s*reporter: Address,\s*delivery_id: DeliveryId,?\s*\)/);
    expect(src).toMatch(/pub fn resolve_dispute\(env: Env, caller: Address, delivery_id: DeliveryId\)/);
  });

  describe('syncDisputeFromEscrow', () => {
    test('encodes (caller, reporter, u64 delivery ID)', async () => {
      await client.syncDisputeFromEscrow({
        caller: ESCROW_CONTRACT,
        reporter: ADMIN_ACCOUNT,
        deliveryId: 18_446_744_073_709_551_615n,
      });

      expect(call).toHaveBeenCalledWith(
        'sync_dispute_from_escrow',
        [
          { kind: 'address', value: ESCROW_CONTRACT },
          { kind: 'address', value: ADMIN_ACCOUNT },
          { kind: 'u64', value: 18_446_744_073_709_551_615n },
        ],
        undefined
      );
    });

    test('rejects an account caller before submitting', async () => {
      await expect(
        client.syncDisputeFromEscrow({ caller: ADMIN_ACCOUNT, reporter: ADMIN_ACCOUNT, deliveryId: 1n })
      ).rejects.toThrow(/peer-only/);
      expect(call).not.toHaveBeenCalled();
    });

    test('propagates a contract rejection for a non-escrow contract caller', async () => {
      call.mockRejectedValue(new Error('TrustchainError.Unauthorized'));

      await expect(
        client.syncDisputeFromEscrow({ caller: DISPUTE_CONTRACT, reporter: ADMIN_ACCOUNT, deliveryId: 1n })
      ).rejects.toThrow('Unauthorized');
    });
  });

  describe('resolveDispute', () => {
    test('encodes (caller, u64 delivery ID)', async () => {
      await client.resolveDispute({ caller: DISPUTE_CONTRACT, deliveryId: 9n });

      expect(call).toHaveBeenCalledWith(
        'resolve_dispute',
        [
          { kind: 'address', value: DISPUTE_CONTRACT },
          { kind: 'u64', value: 9n },
        ],
        undefined
      );
    });

    test.each([[ADMIN_ACCOUNT], [''], ['C' + 'A'.repeat(54)]])(
      'rejects a non-contract caller %p before submitting',
      async (caller) => {
        await expect(client.resolveDispute({ caller, deliveryId: 9n })).rejects.toThrow(/peer-only/);
        expect(call).not.toHaveBeenCalled();
      }
    );

    test('propagates InvalidState when the delivery is not Disputed', async () => {
      call.mockRejectedValue(new Error('TrustchainError.InvalidState'));

      await expect(client.resolveDispute({ caller: DISPUTE_CONTRACT, deliveryId: 9n })).rejects.toThrow(
        'InvalidState'
      );
    });
  });
});
