# SDK / Contract Signature Parity

The TypeScript SDK in `sdk/typescript/` wraps the Rust Soroban contracts in
`contracts/*/lib.rs`. Nothing generates the SDK client methods from the Rust
`pub fn` signatures — they are hand-written and hand-kept in sync. This
document records what is actually checked today, and the manual process that
covers the gap, so a reviewer knows where to look when a contract method
changes.

## What is automatically checked today

`sdk/typescript/src/__tests__/type-parity.test.ts` checks **data-shape**
parity, not method-signature parity: it reads
`contracts/shared_types/lib.rs` as text and asserts that SDK enums/structs
(`EscrowStatus`, `DeliveryStatus`, `DriverStatus`, `DriverProfile`) carry
exactly the same variants/fields as the contract types. For example it
extracts the `EscrowState` enum block from the Rust source and asserts it
still equals `['Locked', 'Holdback', 'Released', 'Refunded', 'Paused',
'Split']` before diffing that list against `Object.values(EscrowStatus)`
(`sdk/typescript/src/__tests__/type-parity.test.ts:51-62`).

There is no equivalent automated check for **client method signatures**
against **contract function signatures** (argument names, order, types,
return types). That parity is currently maintained by hand.

## Manual process for method-signature parity

Until an automated check exists, anyone changing a contract's public
function signature MUST walk the matching SDK client method and update it in
the same PR. Concretely, for the escrow contract:

| Contract function (`contracts/escrow_contract/lib.rs`) | SDK method (`sdk/typescript/src/clients/escrow.client.ts`) |
|---|---|
| `pub fn init(env: Env, admin: Address, token: Address, platform_fee_bps: u32)` (line 697) | `async init(params: EscrowTypes.InitParams, options?: ContractInvokeOptions)` (line 20) |
| `pub fn update_platform_fee(env: Env, admin: Address, new_fee_bps: u32)` (line 731) | `async updatePlatformFee(...)` (line 27) |
| `pub fn get_platform_fee(env: Env) -> u32` (line 759) | `async getPlatformFee(options?: ContractInvokeOptions): Promise<number>` (line 37) |
| `pub fn get_admin(env: Env) -> Address` (line 763) | `async getAdmin(options?: ContractInvokeOptions): Promise<string>` (line 44) |
| `pub fn get_total_locked` / similar getters | `async getTotalLocked(token: string, ...): Promise<bigint>` (line 58) |

The pattern to follow when changing a contract function:

1. Update the Rust `pub fn` in the relevant `contracts/<name>/lib.rs`.
2. Find the matching method in `sdk/typescript/src/clients/<name>.client.ts`
   (methods are named by converting the Rust `snake_case` function name to
   `camelCase`, e.g. `update_platform_fee` -> `updatePlatformFee`).
3. Update the method's parameter list/types and return type to match. The
   `env: Env` first parameter is always dropped on the SDK side — it's
   supplied by the invocation layer, not the caller — so compare the Rust
   signature starting from its *second* parameter against the SDK method's
   first parameter.
4. Update the corresponding type in `sdk/typescript/src/types/<name>.types.ts`
   if the function takes/returns a struct (e.g. `EscrowTypes.InitParams`,
   `EscrowRecord`).
5. Update or add a test in `sdk/typescript/src/__tests__/` or
   `sdk/typescript/src/clients/*.test.ts` that exercises the changed method.
6. If the change affects an enum/struct already covered by
   `type-parity.test.ts`, that test will fail automatically; if it's a new
   shared type, add a case to `type-parity.test.ts` following the existing
   `unitEnumVariants`/`extractBlock` pattern so future drift is caught
   automatically instead of relying on step 1-5 being remembered.

## Where a real automated signature-parity check should live

A proper check would need to parse each contract's `pub fn` signatures (not
just enum/struct bodies) and assert each has a corresponding SDK client
method with a parameter list that maps 1:1 (minus the dropped `env: Env`).
That belongs in a new test file alongside the existing one, e.g.
`sdk/typescript/src/__tests__/method-parity.test.ts`, using the same
text-extraction approach `type-parity.test.ts` already uses for
`contracts/shared_types/lib.rs`, but pointed at each `contracts/<name>/lib.rs`
and compared against `contracts/<name>.client.ts`. This file documents the
manual process in the meantime so the gap isn't silent.
