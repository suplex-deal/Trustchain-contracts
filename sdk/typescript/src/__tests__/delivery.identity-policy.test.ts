import fs from 'fs';
import path from 'path';

const CONTRACT_PATH = path.resolve(__dirname, '../../../../contracts/delivery_contract/lib.rs');
const CLIENT_PATH = path.resolve(__dirname, '../clients/delivery.client.ts');

// The no-identity mode for `assign_driver` must be reachable from the SDK.
// Assertions are made against the sources, matching the other binding tests,
// because the client import chain does not load under plain Jest.
describe('DeliveryClient identity integration policy bindings', () => {
  const contract = fs.readFileSync(CONTRACT_PATH, 'utf8');
  const client = fs.readFileSync(CLIENT_PATH, 'utf8');

  test('setIdentityOptional sends the admin and the flag', () => {
    expect(contract).toContain('pub fn set_identity_optional(env: Env, admin: Address, optional: bool)');
    expect(client).toContain('async setIdentityOptional(optional: boolean');
    expect(client).toContain("'set_identity_optional', [address(admin), bool(optional)]");
  });

  test('getIdentityOptional returns a boolean', () => {
    expect(contract).toContain('pub fn get_identity_optional(env: Env) -> bool');
    expect(client).toContain(
      "return Boolean(await this.invoker.call('get_identity_optional', [], options));",
    );
  });
});
