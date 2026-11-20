#!/bin/bash

# Trustchain-contracts - Initialization Script
# Usage: ./initialize-all-contracts.sh [testnet|mainnet]

set -e

NETWORK=${1:-testnet}
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

# Parse contract IDs from JSON
get_contract_id() {
    grep -o "\"$1\": *\"[^\"]*\"" "$CONTRACT_IDS_FILE" | grep -o '"[^"]*"$' | tr -d '"'
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

# Issue #93: every contract's init() panics with AlreadyInitialized on a
# second call, and this script runs under `set -e`, so a failure partway
# through (e.g. step 3's init rejected on-chain) previously left no way to
# resume: re-running from the top would hit AlreadyInitialized on step 1 and
# abort again before ever reaching the steps that still need to run.
#
# is_contract_initialized() probes each contract's own read-only accessor
# (get_admin on every contract here) to find out, independent of this
# script's own state, whether that specific contract was already
# initialized on-chain. init_if_needed() uses that to skip contracts already
# done and only run init on the ones still pending, so re-running the script
# after a partial failure resumes instead of erroring or double-initializing.
is_contract_initialized() {
    local contract_id=$1
    stellar contract invoke \
        --id "$contract_id" \
        --source "$DEPLOYER_IDENTITY" \
        --network "$NETWORK" \
        -- get_admin &> /dev/null
}

init_if_needed() {
    local label=$1
    local contract_id=$2
    shift 2
    if is_contract_initialized "$contract_id"; then
        echo "✓ $label already initialized (resuming — skipped)"
    else
        echo "Initializing $label..."
        invoke_contract "$contract_id" "$@"
        echo "✓ $label initialized"
    fi
}

DISPUTE_TIME_LIMIT=${DISPUTE_TIME_LIMIT:-86400}
DISPUTE_RESOLUTION_LIMIT=${DISPUTE_RESOLUTION_LIMIT:-86400}

echo "Escrow Contract: $ESCROW_ID"
echo "Delivery Contract: $DELIVERY_ID"
echo "Dispute Resolution Contract: $DISPUTE_ID"
echo "Fleet Management Contract: $FLEET_ID"
echo "Identity Reputation Contract: $IDENTITY_ID"
echo "Settlement Contract: $SETTLEMENT_ID"
echo ""

init_if_needed "Escrow Contract" "$ESCROW_ID" init \
    --admin "$ADMIN_ADDRESS" \
    --token "$TOKEN_ADDRESS" \
    --platform_fee_bps "${PLATFORM_FEE_BPS:-250}"

init_if_needed "Delivery Contract" "$DELIVERY_ID" init \
    --admin "$ADMIN_ADDRESS" \
    --escrow_contract "$ESCROW_ID"

init_if_needed "Dispute Resolution Contract" "$DISPUTE_ID" init \
    --admin "$ADMIN_ADDRESS" \
    --delivery_contract "$DELIVERY_ID" \
    --escrow_contract "$ESCROW_ID" \
    --dispute_time_limit "$DISPUTE_TIME_LIMIT" \
    --dispute_resolution_limit "$DISPUTE_RESOLUTION_LIMIT"

init_if_needed "Fleet Management Contract" "$FLEET_ID" init \
    --admin "$ADMIN_ADDRESS"

init_if_needed "Identity Reputation Contract" "$IDENTITY_ID" init \
    --admin "$ADMIN_ADDRESS" \
    --delivery_contract "$DELIVERY_ID" \
    --dispute_contract "$DISPUTE_ID"

init_if_needed "Settlement Contract" "$SETTLEMENT_ID" init \
    --admin "$ADMIN_ADDRESS" \
    --escrow_contract "$ESCROW_ID"
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

echo "✓ Contract integrations configured"
echo ""
echo "✅ All contracts initialized successfully!"
exit 0
