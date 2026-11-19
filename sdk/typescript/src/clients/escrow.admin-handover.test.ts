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

describe('EscrowClient admin handover', () => {
  it('proposes, then accepts, an admin handover with the right signers', async () => {
    const client = new EscrowClient('CESCROW');
    const call = getCall(client).mockResolvedValue(undefined);

    await client.proposeAdmin({ currentAdmin: 'GOLD', newAdmin: 'GNEW' });
    await client.acceptAdmin({ newAdmin: 'GNEW' }, { sourceAccount: 'GNEW' });

    expect(call).toHaveBeenNthCalledWith(1, 'propose_admin', ['GOLD', 'GNEW'], undefined);
    expect(call).toHaveBeenNthCalledWith(2, 'accept_admin', ['GNEW'], { sourceAccount: 'GNEW' });
  });

  it('cancels a pending proposal as the current admin', async () => {
    const client = new EscrowClient('CESCROW');
    const call = getCall(client).mockResolvedValue(undefined);

    await client.cancelAdminProposal({ currentAdmin: 'GOLD' });

    expect(call).toHaveBeenCalledWith('cancel_admin_proposal', ['GOLD'], undefined);
  });

  it('rejects a proposal from a non-admin caller', async () => {
    const client = new EscrowClient('CESCROW');
    getCall(client).mockRejectedValue(new Error('Unauthorized'));

    await expect(client.proposeAdmin({ currentAdmin: 'GMALLORY', newAdmin: 'GMALLORY' }))
      .rejects.toThrow('Unauthorized');
  });

  it('rejects acceptance by an address other than the nominee', async () => {
    const client = new EscrowClient('CESCROW');
    getCall(client).mockRejectedValue(new Error('Unauthorized'));

    await expect(client.acceptAdmin({ newAdmin: 'GMALLORY' })).rejects.toThrow('Unauthorized');
  });

  it('rejects cancel/accept when no proposal is pending', async () => {
    const client = new EscrowClient('CESCROW');
    getCall(client).mockRejectedValue(new Error('InvalidState'));

    await expect(client.cancelAdminProposal({ currentAdmin: 'GOLD' })).rejects.toThrow('InvalidState');
    await expect(client.acceptAdmin({ newAdmin: 'GNEW' })).rejects.toThrow('InvalidState');
  });
});
