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

describe('EscrowClient delivery peer rotation', () => {
  it('proposes a delivery contract rotation via set_delivery_contract', async () => {
    const client = new EscrowClient('CESCROW');
    const call = getCall(client).mockResolvedValue(undefined);

    await client.proposeDeliveryContract({ admin: 'GADMIN', deliveryContract: 'CDELIVERY2' });

    expect(call).toHaveBeenCalledWith('set_delivery_contract', ['GADMIN', 'CDELIVERY2'], undefined);
  });

  it('confirms a pending rotation with no arguments', async () => {
    const client = new EscrowClient('CESCROW');
    const call = getCall(client).mockResolvedValue(undefined);

    await client.confirmDeliveryContract();

    expect(call).toHaveBeenCalledWith('confirm_delivery_contract', [], undefined);
  });

  it('decodes the pending rotation and current address', async () => {
    const client = new EscrowClient('CESCROW');
    const call = getCall(client)
      .mockResolvedValueOnce({ address: 'CDELIVERY2', proposed_by: 'GADMIN', activates_at: 1_700_259_200 })
      .mockResolvedValueOnce('CDELIVERY1');

    await expect(client.getPendingDeliveryContract()).resolves.toEqual({
      deliveryContract: 'CDELIVERY2',
      proposedBy: 'GADMIN',
      activatesAt: 1_700_259_200n,
    });
    await expect(client.getDeliveryContract()).resolves.toBe('CDELIVERY1');
    expect(call).toHaveBeenNthCalledWith(1, 'get_pending_delivery_contract', [], undefined);
    expect(call).toHaveBeenNthCalledWith(2, 'get_delivery_contract', [], undefined);
  });

  it('returns null when no rotation is pending and no peer is configured', async () => {
    const client = new EscrowClient('CESCROW');
    getCall(client).mockResolvedValueOnce(null).mockResolvedValueOnce(undefined);

    await expect(client.getPendingDeliveryContract()).resolves.toBeNull();
    await expect(client.getDeliveryContract()).resolves.toBeNull();
  });

  it('surfaces a confirmation rejected before the timelock elapses', async () => {
    const client = new EscrowClient('CESCROW');
    getCall(client).mockRejectedValue(new Error('ContractChangeTimelockNotElapsed'));

    await expect(client.confirmDeliveryContract()).rejects.toThrow('ContractChangeTimelockNotElapsed');
  });

  it('surfaces a proposal rejected for a non-admin caller', async () => {
    const client = new EscrowClient('CESCROW');
    getCall(client).mockRejectedValue(new Error('Unauthorized'));

    await expect(
      client.proposeDeliveryContract({ admin: 'GNOTADMIN', deliveryContract: 'CDELIVERY2' })
    ).rejects.toThrow('Unauthorized');
  });
});
