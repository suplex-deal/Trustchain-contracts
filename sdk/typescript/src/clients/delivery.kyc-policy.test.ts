jest.mock('./invoker', () => ({
  ContractInvoker: jest.fn().mockImplementation(() => ({ call: jest.fn() })),
  address: (value: string) => value,
  bool: (value: boolean) => value,
  map: (fields: Array<[string, unknown]>) => Object.fromEntries(fields),
  string: (value: string) => value,
  symbol: (value: string) => value,
  u32: (value: number) => value,
  u64: (value: bigint | number) => BigInt(value),
}));

import { DeliveryClient } from './delivery.client';

function getCall(client: DeliveryClient): jest.Mock {
  const invoker = Reflect.get(client, 'invoker') as object;
  return Reflect.get(invoker, 'call') as jest.Mock;
}

describe('DeliveryClient KYC policy', () => {
  it.each([true, false])('sets require_kyc=%s as the admin', async (required) => {
    const client = new DeliveryClient('CDELIVERY');
    const call = getCall(client).mockResolvedValue(undefined);

    await client.setRequireKyc({ admin: 'GADMIN', required });

    expect(call).toHaveBeenCalledWith('set_require_kyc', ['GADMIN', required], undefined);
  });

  it('reads the current gate', async () => {
    const client = new DeliveryClient('CDELIVERY');
    const call = getCall(client).mockResolvedValueOnce(true);

    await expect(client.getRequireKyc()).resolves.toBe(true);
    expect(call).toHaveBeenCalledWith('get_require_kyc', [], undefined);
  });

  it('treats an unset gate as disabled', async () => {
    const client = new DeliveryClient('CDELIVERY');
    getCall(client).mockResolvedValueOnce(undefined);

    await expect(client.getRequireKyc()).resolves.toBe(false);
  });

  it('surfaces a rejection for a non-admin caller', async () => {
    const client = new DeliveryClient('CDELIVERY');
    getCall(client).mockRejectedValue(new Error('Unauthorized'));

    await expect(client.setRequireKyc({ admin: 'GMALLORY', required: false })).rejects.toThrow('Unauthorized');
  });
});
