#!/bin/bash

# Trustchain-contracts - Initialization Script
# Usage: ./initialize-all-contracts.sh [testnet|mainnet]

set -e

NETWORK=${1:-testnet}
case "$NETWORK" in
    testnet|mainnet|futurenet) ;;
    *)
        echo "❌ Unsupported network: '$NETWORK'" >&2
        echo "   Valid networks: testnet, mainnet, futurenet" >&2
        exit 1
        ;;
esac
# Mode: "init" (default) runs the full initialization + peer-contract
# proposal flow below. "confirm-peers" instead confirms every timelocked
# peer-contract pointer that was proposed by an earlier "init" run, once the
# PEER_CONTRACT_CHANGE_TIMELOCK_SECONDS review period has elapsed.
MODE=${2:-init}
# Name of the Stellar CLI identity every deploy/initialize script signs with.
# Overridable, but the default must match the identity provisioned by
# .github/workflows/deploy-testnet.yml and documented in docs/DEPLOYMENT.md.
DEPLOYER_IDENTITY="${DEPLOYER_IDENTITY:-deployer}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTRACT_IDS_FILE="$PROJECT_ROOT/contract-ids-$NETWORK.json"

echo "🔧 Initializing Trustchain-contracts"
echo "======================================"
echo "Network: $NETWORK"
echo ""

# Check if contract IDs file exists
if [ ! -f "$CONTRACT_IDS_FILE" ]; then
    echo "❌ Contract IDs file not found: $CONTRACT_IDS_FILE"
    echo "Please deploy contracts first using deploy-all-contracts.sh"
    exit 1
fi

# Load environment variables
if [ -f "$PROJECT_ROOT/.env" ]; then
    source "$PROJECT_ROOT/.env"
else
    echo "⚠️  No .env file found. Using defaults."
fi

# Verify the signing identity exists before any invoke is attempted.
if ! stellar keys address "$DEPLOYER_IDENTITY" &> /dev/null; then
    echo "❌ Stellar CLI identity '$DEPLOYER_IDENTITY' not found."
    echo "   Every deploy/initialize script signs with it (--source $DEPLOYER_IDENTITY)."
    echo "   • CI: the 'Configure deployer identity' step in"
    echo "     .github/workflows/deploy-testnet.yml provisions it from the"
    echo "     CONTRACT_DEPLOYER_SECRET secret (environment secret"
    echo "     TESTNET_DEPLOYER_SECRET)."
    echo "   • Local: create it once with"
    echo "       stellar keys generate $DEPLOYER_IDENTITY --network $NETWORK"
    echo "     or import an existing key with"
    echo "       stellar keys add $DEPLOYER_IDENTITY --secret-key"
    exit 1
fi

# Parse contract IDs from JSON.
#
# Previously this grepped "$1": "..." over the whole file, which only
# happened to work because the manifest's top-level keys (network,
# deployed_at, deployer_address) never collide with a contract name. That
# breaks the moment the "contracts" object is nested inside anything else,
# or a sibling top-level key reuses a contract's name (e.g. a future
# "previous_contracts" block) - the regex can't tell which object a match
# came from. Instead, first isolate the body of the top-level "contracts"
# object (from its opening "{" to its matching closing "}", tracking brace
# depth) and only look up keys inside that slice.
CONTRACTS_BLOCK=$(awk '
    /"contracts"[[:space:]]*:[[:space:]]*\{/ { in_block=1 }
    in_block {
        for (i = 1; i <= length($0); i++) {
            c = substr($0, i, 1)
            if (c == "{") { depth++; if (depth == 1) next }
            if (c == "}") {
                depth--
                if (depth == 0) { in_block = 0; exit }
            }
        }
        if (in_block) print
    }
' "$CONTRACT_IDS_FILE")

get_contract_id() {
    echo "$CONTRACTS_BLOCK" | grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | grep -o '"[^"]*"$' | tr -d '"'
}

ESCROW_ID=$(get_contract_id "escrow_contract")
DELIVERY_ID=$(get_contract_id "delivery_contract")
DISPUTE_ID=$(get_contract_id "dispute_resolution_contract")
FLEET_ID=$(get_contract_id "fleet_management_contract")
IDENTITY_ID=$(get_contract_id "identity_reputation_contract")
SETTLEMENT_ID=$(get_contract_id "settlement_contract")

for contract in \
    "escrow_contract:$ESCROW_ID" \
    "delivery_contract:$DELIVERY_ID" \
    "dispute_resolution_contract:$DISPUTE_ID" \
    "fleet_management_contract:$FLEET_ID" \
    "identity_reputation_contract:$IDENTITY_ID" \
    "settlement_contract:$SETTLEMENT_ID"; do
    if [ -z "${contract#*:}" ]; then
        echo "❌ ${contract%%:*} ID not found in $CONTRACT_IDS_FILE"
        exit 1
    fi
done

if [ -z "$ADMIN_ADDRESS" ] || [ -z "$TOKEN_ADDRESS" ]; then
    echo "❌ ADMIN_ADDRESS and TOKEN_ADDRESS must be set (in .env or the environment)"
    exit 1
fi

invoke_contract() {
    local contract_id=$1
    shift
    stellar contract invoke \
        --id "$contract_id" \
        --source "$DEPLOYER_IDENTITY" \
        --network "$NETWORK" \
        -- "$@"
}

DISPUTE_TIME_LIMIT=${DISPUTE_TIME_LIMIT:-86400}
DISPUTE_RESOLUTION_LIMIT=${DISPUTE_RESOLUTION_LIMIT:-86400}

if [ "$MODE" = "confirm-peers" ]; then
    echo "🔐 Confirming timelocked peer-contract pointers on $NETWORK..."
    echo ""

    echo "Confirming Delivery Contract's escrow_contract..."
    invoke_contract "$DELIVERY_ID" confirm_escrow_contract
    echo "✓ Delivery's escrow_contract confirmed"

    echo "Confirming Dispute Resolution Contract's delivery_contract..."
    invoke_contract "$DISPUTE_ID" confirm_delivery_contract
    echo "✓ Dispute resolution's delivery_contract confirmed"

    echo "Confirming Dispute Resolution Contract's escrow_contract..."
    invoke_contract "$DISPUTE_ID" confirm_escrow_contract
    echo "✓ Dispute resolution's escrow_contract confirmed"

    echo "Confirming Fleet Management Contract's escrow_contract..."
    invoke_contract "$FLEET_ID" confirm_escrow_contract
    echo "✓ Fleet management's escrow_contract confirmed"

    echo "Confirming Fleet Management Contract's identity_contract..."
    invoke_contract "$FLEET_ID" confirm_identity_contract
    echo "✓ Fleet management's identity_contract confirmed"

    echo "Confirming Identity Reputation Contract's delivery_contract..."
    invoke_contract "$IDENTITY_ID" confirm_delivery_contract
    echo "✓ Identity reputation's delivery_contract confirmed"

    echo "Confirming Settlement Contract's escrow_contract..."
    invoke_contract "$SETTLEMENT_ID" confirm_escrow_contract
    echo "✓ Settlement's escrow_contract confirmed"

    echo "Confirming Escrow Contract's delivery_contract..."
    invoke_contract "$ESCROW_ID" confirm_delivery_contract
    echo "✓ Escrow's delivery_contract confirmed"

    echo ""
    echo "✅ All timelocked peer-contract pointers confirmed!"
    exit 0
fi

echo "Escrow Contract: $ESCROW_ID"
echo "Delivery Contract: $DELIVERY_ID"
echo "Dispute Resolution Contract: $DISPUTE_ID"
echo "Fleet Management Contract: $FLEET_ID"
echo "Identity Reputation Contract: $IDENTITY_ID"
echo "Settlement Contract: $SETTLEMENT_ID"
echo ""

echo "Initializing Escrow Contract..."
invoke_contract "$ESCROW_ID" init \
    --admin "$ADMIN_ADDRESS" \
    --token "$TOKEN_ADDRESS" \
    --platform_fee_bps "${PLATFORM_FEE_BPS:-250}"
echo "✓ Escrow initialized"

echo "Initializing Delivery Contract..."
invoke_contract "$DELIVERY_ID" init \
    --admin "$ADMIN_ADDRESS" \
    --escrow_contract "$ESCROW_ID"
echo "✓ Delivery initialized"

echo "Initializing Dispute Resolution Contract..."
invoke_contract "$DISPUTE_ID" init \
    --admin "$ADMIN_ADDRESS" \
    --delivery_contract "$DELIVERY_ID" \
    --escrow_contract "$ESCROW_ID" \
    --dispute_time_limit "$DISPUTE_TIME_LIMIT" \
    --dispute_resolution_limit "$DISPUTE_RESOLUTION_LIMIT"
echo "✓ Dispute resolution initialized"

echo "Initializing Fleet Management Contract..."
invoke_contract "$FLEET_ID" init \
    --admin "$ADMIN_ADDRESS"
echo "✓ Fleet management initialized"

echo "Initializing Identity Reputation Contract..."
invoke_contract "$IDENTITY_ID" init \
    --admin "$ADMIN_ADDRESS" \
    --delivery_contract "$DELIVERY_ID" \
    --dispute_contract "$DISPUTE_ID"
echo "✓ Identity reputation initialized"

echo "Initializing Settlement Contract..."
invoke_contract "$SETTLEMENT_ID" init \
    --admin "$ADMIN_ADDRESS" \
    --escrow_contract "$ESCROW_ID"
echo "✓ Settlement initialized"
echo ""

echo "Wiring contract integrations..."
invoke_contract "$DELIVERY_ID" set_escrow_contract \
    --admin "$ADMIN_ADDRESS" \
    --escrow_contract "$ESCROW_ID"
invoke_contract "$DELIVERY_ID" set_dispute_resolution_contract \
    --admin "$ADMIN_ADDRESS" \
    --dispute_contract "$DISPUTE_ID"
invoke_contract "$DELIVERY_ID" set_identity_reputation_contract \
    --admin "$ADMIN_ADDRESS" \
    --identity_contract "$IDENTITY_ID"

invoke_contract "$DISPUTE_ID" set_delivery_contract \
    --caller "$ADMIN_ADDRESS" \
    --delivery_contract "$DELIVERY_ID"
invoke_contract "$DISPUTE_ID" set_escrow_contract \
    --caller "$ADMIN_ADDRESS" \
    --escrow_contract "$ESCROW_ID"
invoke_contract "$DISPUTE_ID" set_identity_reputation_contract \
    --caller "$ADMIN_ADDRESS" \
    --reputation_contract "$IDENTITY_ID"

invoke_contract "$FLEET_ID" set_escrow_contract \
    --admin "$ADMIN_ADDRESS" \
    --escrow_contract "$ESCROW_ID"
invoke_contract "$FLEET_ID" set_identity_contract \
    --admin "$ADMIN_ADDRESS" \
    --identity_contract "$IDENTITY_ID"

invoke_contract "$IDENTITY_ID" set_delivery_contract \
    --admin "$ADMIN_ADDRESS" \
    --delivery_contract "$DELIVERY_ID"
invoke_contract "$IDENTITY_ID" set_dispute_contract \
    --admin "$ADMIN_ADDRESS" \
    --dispute_contract "$DISPUTE_ID"

invoke_contract "$SETTLEMENT_ID" set_escrow_contract \
    --admin "$ADMIN_ADDRESS" \
    --new_escrow "$ESCROW_ID"

invoke_contract "$ESCROW_ID" set_delivery_contract \
    --admin "$ADMIN_ADDRESS" \
    --delivery_contract "$DELIVERY_ID"
invoke_contract "$ESCROW_ID" set_dispute_resolution_contract \
    --admin "$ADMIN_ADDRESS" \
    --dispute_contract "$DISPUTE_ID"
invoke_contract "$ESCROW_ID" set_identity_reputation_contract \
    --admin "$ADMIN_ADDRESS" \
    --identity_contract "$IDENTITY_ID"
invoke_contract "$ESCROW_ID" set_fleet_management_contract \
    --admin "$ADMIN_ADDRESS" \
    --fleet_contract "$FLEET_ID"

echo "✓ Contract integrations configured (proposed, pending timelock)"
echo ""
echo "⏳ Several of the peer-contract pointers above (delivery_contract's"
echo "   escrow_contract, dispute_resolution_contract's delivery_contract and"
echo "   escrow_contract, identity_reputation_contract's delivery_contract,"
echo "   fleet_management_contract's escrow_contract and identity_contract,"
echo "   settlement_contract's escrow_contract, and escrow_contract's"
echo "   delivery_contract) are timelocked and only take effect once"
echo "   confirmed after the review period elapses."
echo ""
echo "   Once the timelock has elapsed, run:"
echo "     ./scripts/initialize-all-contracts.sh $NETWORK confirm-peers"
echo ""
echo "✅ All contracts initialized successfully!"
exit 0
