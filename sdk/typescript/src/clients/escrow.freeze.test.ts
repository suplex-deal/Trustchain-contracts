jest.mock('./invoker', () => ({
  ContractInvoker: jest.fn().mockImplementation(() => ({ call: jest.fn() })),
  address: (value: string) => value,
  bool: (value: boolean) => value,
  u32: (value: number) => value,
  u64: (value: bigint) => value,
}));
jest.mock('@stellar/stellar-sdk', () => ({
  nativeToScVal: (value: unknown) => value,
}));

import { EscrowClient } from './escrow.client';

function getCall(client: EscrowClient): jest.Mock {
  const invoker = Reflect.get(client, 'invoker') as object;
  return Reflect.get(invoker, 'call') as jest.Mock;
}

describe('EscrowClient emergency freeze', () => {
  it('freezes funds as the admin via admin_freeze_funds', async () => {
    const client = new EscrowClient('CESCROW');
    const call = getCall(client).mockResolvedValue(undefined);

    await client.adminFreezeFunds({ admin: 'GADMIN', deliveryId: 42n });

    expect(call).toHaveBeenCalledWith('admin_freeze_funds', ['GADMIN', 42n], undefined);
  });

  it('freezes funds as the dispute contract via freeze_funds', async () => {
    const client = new EscrowClient('CESCROW');
    const call = getCall(client).mockResolvedValue(undefined);

    await client.freezeFunds({ caller: 'CDISPUTE', deliveryId: 42n });

    expect(call).toHaveBeenCalledWith('freeze_funds', ['CDISPUTE', 42n], undefined);
  });

  it('rejects an admin freeze from a non-admin', async () => {
    const client = new EscrowClient('CESCROW');
    getCall(client).mockRejectedValue(new Error('Unauthorized'));

    await expect(client.adminFreezeFunds({ admin: 'GMALLORY', deliveryId: 42n })).rejects.toThrow('Unauthorized');
  });

  it('rejects freeze_funds from anything but the dispute contract', async () => {
    const client = new EscrowClient('CESCROW');
    getCall(client).mockRejectedValue(new Error('Unauthorized'));

    await expect(client.freezeFunds({ caller: 'GADMIN', deliveryId: 42n })).rejects.toThrow('Unauthorized');
  });

  it('rejects freezing an already-settled escrow', async () => {
    const client = new EscrowClient('CESCROW');
    getCall(client).mockRejectedValue(new Error('InvalidState'));

    await expect(client.adminFreezeFunds({ admin: 'GADMIN', deliveryId: 7n })).rejects.toThrow('InvalidState');
  });
});
