# Trustchain TypeScript SDK

Typed SDK for interacting with Trustchain-contracts on Stellar Soroban.

> Status: the package is intentionally versioned at `0.2.0` to match the protocol crates and is currently in a partial implementation state. The workspace includes working escrow and delivery clients and the additional contract clients/types added in this update, but the SDK is not yet considered a stable production release.

## Installation

```bash
npm install @trustchain/sdk
```

## SDK Status

This package is currently a typed API preview, not a connected runtime client. The generated method signatures are present, but the underlying Soroban invocation layer is not complete in this repository snapshot. The examples below intentionally fail at runtime with a clear "not implemented" message rather than silently pretending a chain call happened.

### Implemented vs. preview-only

| Client | Status | Notes |
|---|---|---|
| EscrowClient | Preview-only | Type signatures and argument shapes are available; live invocation is not yet implemented in the checked-in example. |
| DeliveryClient | Preview-only | Same as above for delivery methods and metadata payloads. |
| DisputeResolutionClient | Preview-only | Dispute lifecycle, voting, and resolution methods are typed; live invocation is not yet implemented. |
| IdentityReputationClient | Preview-only | Identity registration and reputation scoring methods are typed; live invocation is not yet implemented. |
| FleetManagementClient | Preview-only | Fleet creation, membership, and driver management methods are typed; live invocation is not yet implemented. |
| SettlementClient | Preview-only | Settlement batching and payout methods are typed; live invocation is not yet implemented. |

## Quick Start

### Initialize Clients

```typescript
import {
  EscrowClient,
  DeliveryClient,
  DisputeResolutionClient,
  IdentityReputationClient,
  FleetManagementClient,
  SettlementClient,
} from '@trustchain/sdk';
import { Keypair } from '@stellar/stellar-sdk';

const keypair = Keypair.fromSecret('SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');

const invocation = {
  serverUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  sourceAccount: 'GA123...',
  signer: keypair,
};
const escrowClient = new EscrowClient('CABC...', invocation);
const deliveryClient = new DeliveryClient('CBDE...', invocation);
const disputeClient = new DisputeResolutionClient('CDIS...', invocation);
const identityClient = new IdentityReputationClient('CIDN...', invocation);
const fleetClient = new FleetManagementClient('CFLT...', invocation);
const settlementClient = new SettlementClient('CSTL...', invocation);
```

### Create an Escrow

```typescript
import { EscrowClient } from '@trustchain/sdk';

const client = new EscrowClient('CABC...');

const result = await client.createEscrow({
  sender: 'GA123...',
  recipient: 'GB456...',
  driver: 'GC789...',
  deliveryId: BigInt(1),
  token: 'CCDE...',
  amount: BigInt(1_000_000_000), // 100 XLM (assuming 7 decimals)
  fleetId: BigInt(1),
});
```

### Create Escrows in Batch

`createEscrowsBatch` returns the number of escrows created, matching the
contract's `u32` return value. It does **not** return the created escrow IDs.

```typescript
const createdCount = await client.createEscrowsBatch({
  sender: 'GA123...',
  recipient: 'GB456...',
  driver: 'GC789...',
  token: 'CCDE...',
  amount: BigInt(1_000_000_000),
  deliveryIds: [BigInt(1), BigInt(2), BigInt(3)],
});

console.log(createdCount); // 3 (a number, not bigint IDs)
```

### Release Escrow

```typescript
await client.releaseEscrow({
  caller: 'GA123...',
  deliveryId: BigInt(1),
});
```

### Get Escrow Details

```typescript
const escrow = await client.getEscrow(BigInt(1));
console.log(escrow.status); // EscrowStatus.Released
console.log(escrow.amount); // BigInt(1_000_000_000)
```

### Raise and Resolve a Dispute

```typescript
import { DisputeResolutionClient } from '@trustchain/sdk';

const disputeClient = new DisputeResolutionClient('CDIS...', invocation);

// Open a dispute for a delivery
await disputeClient.raiseDispute({
  caller: 'GA123...',
  deliveryId: BigInt(1),
});

// Resolve the dispute in favour of the driver
await disputeClient.resolveDispute({
  caller: 'GADMIN...',
  deliveryId: BigInt(1),
  releaseToDriver: true,
});

const dispute = await disputeClient.getDispute(BigInt(1));
console.log(dispute.status); // DisputeStatus.Resolved
```

### Manage a Fleet

```typescript
import { FleetManagementClient } from '@trustchain/sdk';

const fleetClient = new FleetManagementClient('CFLT...', invocation);

// Create a fleet owned by the caller
const fleetId = await fleetClient.createFleet({
  owner: 'GA123...',
  name: 'Downtown Couriers',
});

// Add a driver to the fleet
await fleetClient.addDriver({
  caller: 'GA123...',
  fleetId,
  driver: 'GC789...',
});

const fleet = await fleetClient.getFleet(fleetId);
console.log(fleet.drivers); // ['GC789...']
```

## Error Handling

The SDK surfaces contract failures as typed error enums so callers can branch on
specific failure modes instead of parsing strings. Each client exports its own
error enum (for example `EscrowError`, `DeliveryError`, `DisputeResolutionError`,
`FleetManagementError`, and `SettlementError`).

```typescript
import { EscrowClient, EscrowError } from '@trustchain/sdk';

try {
  await client.releaseEscrow({ caller: 'GA123...', deliveryId: BigInt(1) });
} catch (err) {
  if (err instanceof EscrowError) {
    switch (err.code) {
      case EscrowErrorCode.Unauthorized:
        console.error('Caller is not allowed to release this escrow');
        break;
      case EscrowErrorCode.EscrowNotFound:
        console.error('No escrow exists for this delivery');
        break;
      case EscrowErrorCode.InvalidState:
        console.error('Escrow is not in a releasable state');
        break;
      default:
        throw err;
    }
  } else {
    throw err;
  }
}
```

## API Reference

### EscrowClient

#### Methods

##### `init(params: InitParams, options?: ContractInvokeOptions): Promise<void>`
Initialize the escrow contract with admin and fee configuration.

**Parameters:**
- `params.admin`: Admin address
- `params.token`: Token contract address
- `params.platformFeeBps`: Platform fee in basis points (0-1000)

##### `createEscrow(params: CreateEscrowParams, options?: ContractInvokeOptions): Promise<string>`
Create a new escrow for a delivery.

**Parameters:**
- `params.sender`: Address funding the escrow
- `params.recipient`: Address receiving delivery confirmation
- `params.driver`: Address of the delivery driver
- `params.deliveryId`: Unique delivery identifier
- `params.token`: Token contract address
- `params.amount`: Escrow amount in token units
- `params.fleetId`: (Optional) Fleet ID if driver is part of a fleet

##### `createEscrowsBatch(params: CreateEscrowsBatchParams, options?: ContractInvokeOptions): Promise<number>`
Create multiple escrows in a single invocation. Returns the number of escrows
created, decoded from the contract's `u32` return value.

**Parameters:**
- `params.sender`: Address funding the escrows
- `params.recipient`: Address receiving delivery confirmation
- `params.driver`: Address of the delivery driver
- `params.token`: Token contract address
- `params.amount`: Escrow amount per delivery in token units
- `params.deliveryIds`: Delivery identifiers to create escrows for

**Returns:** `Promise<number>` — count of escrows created (not escrow IDs).

##### `releaseEscrow(params: ReleaseEscrowParams, options?: ContractInvokeOptions): Promise<void>`
Release escrowed funds to the driver after delivery confirmation.

**Parameters:**
- `params.caller`: Authorized caller (admin or recipient)
- `params.deliveryId`: Delivery identifier

##### `refundEscrow(params: RefundEscrowParams, options?: ContractInvokeOptions): Promise<void>`
Refund escrowed funds to the sender.

**Parameters:**
- `params.caller`: Authorized caller (admin or sender)
- `params.deliveryId`: Delivery identifier

##### `raiseDispute(params: RaiseDisputeParams, options?: ContractInvokeOptions): Promise<void>`
Raise a dispute on an escrow.

**Parameters:**
- `params.caller`: Dispute raiser (sender, recipient, or driver)
- `params.deliveryId`: Delivery identifier

##### `resolveDispute(params: ResolveDisputeParams, options?: ContractInvokeOptions): Promise<void>`
Resolve a dispute by releasing to driver or refunding sender.

**Parameters:**
- `params.caller`: Admin address (required)
- `params.deliveryId`: Delivery identifier
- `params.releaseToDriver`: `true` to pay driver, `false` to refund sender

##### `resolveDisputeSplit(params: ResolveDisputeSplitParams, options?: ContractInvokeOptions): Promise<void>`
Resolve a dispute by splitting funds between sender and driver.

**Parameters:**
- `params.caller`: Admin address (required)
- `params.deliveryId`: Delivery identifier
- `params.senderShareBps`: Sender's share in basis points (0-10000)

##### `getPlatformFee(): Promise<number>`
Get the current platform fee in basis points.

##### `getAdmin(): Promise<string>`
