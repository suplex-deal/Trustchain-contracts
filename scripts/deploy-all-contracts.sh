#!/bin/bash

# Trustchain-contracts - Complete Deployment Script
# Usage: ./deploy-all-contracts.sh [testnet|mainnet] [--dry-run] [--yes]
#
# Issue #92: a mainnet run submits real, irreversible on-chain transactions
# that spend real fees and deploy contracts under the deployer identity's
# funded account, with no prior warning other than the [network] argument.
# This script now requires explicit confirmation before a mainnet run
# executes anything, and supports --dry-run to preview exactly what would be
# deployed without submitting a single transaction.

set -e

NETWORK=${1:-testnet}
DRY_RUN=false
CONFIRMED=false
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=true ;;
        --yes|--confirm) CONFIRMED=true ;;
    esac
done

# Name of the Stellar CLI identity every deploy/initialize script signs with.
# Overridable, but the default must match the identity provisioned by
# .github/workflows/deploy-testnet.yml and documented in docs/DEPLOYMENT.md.
DEPLOYER_IDENTITY="${DEPLOYER_IDENTITY:-deployer}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_FILE="$PROJECT_ROOT/contract-ids-$NETWORK.json"

echo "🚀 Trustchain-contracts Deployment"
echo "=================================="
echo "Network: $NETWORK"
echo "Date: $(date)"
if [ "$DRY_RUN" = true ]; then
    echo "Mode: DRY RUN (no transactions will be submitted)"
fi

# Mainnet is irreversible and costs real fees: require an explicit --yes/
# --confirm flag, or an interactive typed confirmation, before continuing.
# --dry-run always bypasses this (a dry run submits nothing).
if [ "$NETWORK" = "mainnet" ] && [ "$DRY_RUN" = false ]; then
    if [ "$CONFIRMED" = false ]; then
        if [ -t 0 ]; then
            echo ""
            echo "⚠️  You are about to deploy ALL contracts to MAINNET using identity '$DEPLOYER_IDENTITY'."
            echo "   This submits real, irreversible transactions and spends real network fees."
            read -r -p "   Type 'deploy mainnet' to continue: " CONFIRM_TEXT
            if [ "$CONFIRM_TEXT" != "deploy mainnet" ]; then
                echo "❌ Confirmation text did not match. Aborting."
                exit 1
            fi
        else
            echo "❌ Refusing to deploy to mainnet without confirmation." >&2
            echo "   Pass --yes (or --confirm) to proceed non-interactively, or run with --dry-run to preview." >&2
            exit 1
        fi
    fi
    echo "✓ Mainnet deployment confirmed"
fi
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check prerequisites
echo "${BLUE}Checking prerequisites...${NC}"

if ! command -v stellar &> /dev/null; then
    echo "${RED}❌ Stellar CLI not found. Please install it first.${NC}"
    echo "   cargo install --locked stellar-cli"
    exit 1
fi

if ! command -v cargo &> /dev/null; then
    echo "${RED}❌ Cargo not found. Please install Rust.${NC}"
    exit 1
fi

if ! stellar keys address "$DEPLOYER_IDENTITY" &> /dev/null; then
    echo "${RED}❌ Stellar CLI identity '$DEPLOYER_IDENTITY' not found.${NC}"
    echo "   Every deploy/initialize script signs with it (--source $DEPLOYER_IDENTITY)."
    echo "   • CI: the 'Configure deployer identity' step in"
    echo "     .github/workflows/deploy-testnet.yml provisions it from the"
    echo "     CONTRACT_DEPLOYER_SECRET secret (environment secret"
    echo "     TESTNET_DEPLOYER_SECRET). Make sure that secret is set for the"
    echo "     'testnet' environment."
    echo "   • Local: create it once with"
    echo "       stellar keys generate $DEPLOYER_IDENTITY --network $NETWORK"
    echo "     or import an existing key with"
    echo "       stellar keys add $DEPLOYER_IDENTITY --secret-key"
    exit 1
fi

echo "${GREEN}✓ Prerequisites OK${NC}"
echo ""

# Build contracts
# Issue #95: --locked, matching ci.yml/deploy-testnet.yml/release.yml, so this
# deployment build is reproducible from the committed Cargo.lock rather than
# re-resolving dependency versions at build time.
echo "${BLUE}Building contracts...${NC}"
cd "$PROJECT_ROOT"
cargo build --locked --target wasm32v1-none --release

if [ $? -ne 0 ]; then
    echo "${RED}❌ Build failed${NC}"
    exit 1
fi

echo "${GREEN}✓ Build successful${NC}"
echo ""

if [ "$DRY_RUN" = true ]; then
    echo "${YELLOW}Dry run: build succeeded. The following contracts would be deployed to '$NETWORK':${NC}"
    for c in "escrow_contract" "delivery_contract" "dispute_resolution_contract" "fleet_management_contract" "identity_reputation_contract" "settlement_contract"; do
        echo "  - $c ($PROJECT_ROOT/target/wasm32v1-none/release/${c}.wasm)"
    done
    echo ""
    echo "No transactions were submitted. Re-run without --dry-run to deploy for real."
    exit 0
fi

# Deploy function
deploy_contract() {
    local contract_name=$1
    local wasm_path="$PROJECT_ROOT/target/wasm32v1-none/release/${contract_name}.wasm"
    
    echo "${YELLOW}Deploying $contract_name...${NC}"
    
    if [ ! -f "$wasm_path" ]; then
        echo "${RED}❌ WASM file not found: $wasm_path${NC}"
        return 1
    fi
    
    local contract_id=$(stellar contract deploy \
        --wasm "$wasm_path" \
        --source "$DEPLOYER_IDENTITY" \
        --network "$NETWORK" 2>&1)
    
    if [ $? -eq 0 ]; then
        echo "${GREEN}✓ $contract_name deployed: $contract_id${NC}"
        echo "$contract_id"
        return 0
    else
        echo "${RED}❌ Failed to deploy $contract_name${NC}"
        echo "$contract_id"
        return 1
    fi
}

# Initialize JSON output
echo "{" > "$OUTPUT_FILE"
echo "  \"network\": \"$NETWORK\"," >> "$OUTPUT_FILE"
echo "  \"deployed_at\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"," >> "$OUTPUT_FILE"
echo "  \"contracts\": {" >> "$OUTPUT_FILE"

# Deploy contracts in order
CONTRACTS=("escrow_contract" "delivery_contract" "dispute_resolution_contract" "fleet_management_contract" "identity_reputation_contract" "settlement_contract")
DEPLOYED_IDS=()

for i in "${!CONTRACTS[@]}"; do
    contract="${CONTRACTS[$i]}"
    contract_id=$(deploy_contract "$contract")
    
    if [ $? -ne 0 ]; then
        echo "${RED}❌ Deployment failed for $contract${NC}"
        exit 1
    fi
    
    DEPLOYED_IDS+=("$contract_id")
    
    # Add to JSON (with comma except for last)
    if [ $i -lt $((${#CONTRACTS[@]} - 1)) ]; then
        echo "    \"$contract\": \"$contract_id\"," >> "$OUTPUT_FILE"
    else
        echo "    \"$contract\": \"$contract_id\"" >> "$OUTPUT_FILE"
    fi
    
    echo ""
done

# Close JSON
echo "  }" >> "$OUTPUT_FILE"
echo "}" >> "$OUTPUT_FILE"

echo ""
echo "${GREEN}=================================="
echo "✅ All contracts deployed successfully!"
echo "==================================${NC}"
echo ""
echo "Contract IDs saved to: $OUTPUT_FILE"
echo ""
echo "${BLUE}Next steps:${NC}"
echo "1. Initialize contracts with ./scripts/initialize-all-contracts.sh $NETWORK"
echo "2. Verify deployments"
echo "3. Configure frontend/backend with new contract IDs"
echo ""

# Display summary
echo "${BLUE}Deployment Summary:${NC}"
for i in "${!CONTRACTS[@]}"; do
    echo "  ${CONTRACTS[$i]}: ${DEPLOYED_IDS[$i]}"
done

exit 0
