#!/bin/bash

# Trustchain-contracts - Single Contract Deployment Script
# Usage: ./deploy-contract.sh <contract_name> [network] [--dry-run] [--yes]
#
# Issue #92: mainnet submits real, irreversible transactions and spends real
# fees. A mainnet run requires explicit confirmation (--yes/--confirm, or an
# interactive typed prompt); --dry-run builds and reports what would be
# deployed without submitting anything.

set -e

CONTRACT_NAME=$1
NETWORK=${2:-testnet}
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

CONTRACTS=("escrow_contract" "delivery_contract" "dispute_resolution_contract" "fleet_management_contract" "identity_reputation_contract" "settlement_contract")

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

if [ -z "$CONTRACT_NAME" ]; then
    echo "${RED}❌ Usage: $0 <contract_name> [network]${NC}" >&2
    echo "   Valid contract names: ${CONTRACTS[*]}" >&2
    exit 1
fi

CONTRACT_KNOWN=false
for c in "${CONTRACTS[@]}"; do
    if [ "$c" = "$CONTRACT_NAME" ]; then
        CONTRACT_KNOWN=true
        break
    fi
done

if [ "$CONTRACT_KNOWN" = false ]; then
    echo "${RED}❌ Unknown contract: $CONTRACT_NAME${NC}" >&2
    echo "   Valid contract names: ${CONTRACTS[*]}" >&2
    exit 1
fi

# Mainnet is irreversible and costs real fees: require an explicit --yes/
# --confirm flag, or an interactive typed confirmation, before continuing.
# --dry-run always bypasses this (a dry run submits nothing).
if [ "$NETWORK" = "mainnet" ] && [ "$DRY_RUN" = false ]; then
    if [ "$CONFIRMED" = false ]; then
        if [ -t 0 ]; then
            echo "" >&2
            echo "⚠️  You are about to deploy '$CONTRACT_NAME' to MAINNET using identity '$DEPLOYER_IDENTITY'." >&2
            echo "   This submits a real, irreversible transaction and spends real network fees." >&2
            read -r -p "   Type 'deploy mainnet' to continue: " CONFIRM_TEXT
            if [ "$CONFIRM_TEXT" != "deploy mainnet" ]; then
                echo "❌ Confirmation text did not match. Aborting." >&2
                exit 1
            fi
        else
            echo "${RED}❌ Refusing to deploy to mainnet without confirmation.${NC}" >&2
            echo "   Pass --yes (or --confirm) to proceed non-interactively, or run with --dry-run to preview." >&2
            exit 1
        fi
    fi
    echo "${GREEN}✓ Mainnet deployment confirmed${NC}" >&2
fi

echo "🚀 Trustchain-contracts Deployment" >&2
echo "==================================" >&2
echo "Contract: $CONTRACT_NAME" >&2
echo "Network: $NETWORK" >&2
echo "Date: $(date)" >&2
echo "" >&2

# Check prerequisites
echo "${BLUE}Checking prerequisites...${NC}" >&2

if ! command -v stellar &> /dev/null; then
    echo "${RED}❌ Stellar CLI not found. Please install it first.${NC}" >&2
    echo "   cargo install --locked stellar-cli" >&2
    exit 1
fi

if ! command -v cargo &> /dev/null; then
    echo "${RED}❌ Cargo not found. Please install Rust.${NC}" >&2
    exit 1
fi

if ! stellar keys address "$DEPLOYER_IDENTITY" &> /dev/null; then
    echo "${RED}❌ Stellar CLI identity '$DEPLOYER_IDENTITY' not found.${NC}" >&2
    echo "   Every deploy/initialize script signs with it (--source $DEPLOYER_IDENTITY)." >&2
    echo "   • CI: the 'Configure deployer identity' step in" >&2
    echo "     .github/workflows/deploy-testnet.yml provisions it from the" >&2
    echo "     CONTRACT_DEPLOYER_SECRET secret (environment secret" >&2
    echo "     TESTNET_DEPLOYER_SECRET). Make sure that secret is set for the" >&2
    echo "     'testnet' environment." >&2
    echo "   • Local: create it once with" >&2
    echo "       stellar keys generate $DEPLOYER_IDENTITY --network $NETWORK" >&2
    echo "     or import an existing key with" >&2
    echo "       stellar keys add $DEPLOYER_IDENTITY --secret-key" >&2
    exit 1
fi

echo "${GREEN}✓ Prerequisites OK${NC}" >&2
echo "" >&2

# Build the contract
# Issue #95: use --locked (matching ci.yml/deploy-testnet.yml/release.yml) so
# a deployment build always resolves dependencies from the committed
# Cargo.lock instead of silently re-resolving against whatever newer
# semver-compatible versions happen to be available, which would make the
# locally/CI-built WASM non-reproducible across machines and time.
echo "${BLUE}Building $CONTRACT_NAME...${NC}" >&2
cd "$PROJECT_ROOT"
cargo build --locked --target wasm32v1-none --release -p "$CONTRACT_NAME"
echo "${GREEN}✓ Build successful${NC}" >&2
echo "" >&2

WASM_PATH="$PROJECT_ROOT/target/wasm32v1-none/release/${CONTRACT_NAME}.wasm"

if [ ! -f "$WASM_PATH" ]; then
    echo "${RED}❌ WASM file not found: $WASM_PATH${NC}" >&2
    exit 1
fi

if [ "$DRY_RUN" = true ]; then
    echo "${YELLOW}Dry run: build succeeded. Would deploy $CONTRACT_NAME ($WASM_PATH) to '$NETWORK' using identity '$DEPLOYER_IDENTITY'.${NC}" >&2
    echo "No transaction was submitted. Re-run without --dry-run to deploy for real." >&2
    exit 0
fi

# Deploy the contract
echo "${YELLOW}Deploying $CONTRACT_NAME...${NC}" >&2

# NOTE: only the raw stellar CLI output goes to stdout here; all status/log
# lines above and below are sent to stderr so a caller doing
# CONTRACT_ID=$(./deploy-contract.sh ...) captures a clean contract ID
# rather than a blob of interleaved log text.
CONTRACT_ID=$(stellar contract deploy \
    --wasm "$WASM_PATH" \
    --source "$DEPLOYER_IDENTITY" \
    --network "$NETWORK")

echo "${GREEN}✓ $CONTRACT_NAME deployed: $CONTRACT_ID${NC}" >&2
echo "" >&2

# Merge this contract's ID into any existing output file for this network,
# so deploying contracts one at a time doesn't clobber previously deployed IDs.
declare -A DEPLOYED_IDS
if [ -f "$OUTPUT_FILE" ]; then
    for c in "${CONTRACTS[@]}"; do
        existing_id=$(grep -o "\"$c\": *\"[^\"]*\"" "$OUTPUT_FILE" | grep -o '"[^"]*"$' | tr -d '"')
        if [ -n "$existing_id" ]; then
            DEPLOYED_IDS["$c"]="$existing_id"
        fi
    done
fi
DEPLOYED_IDS["$CONTRACT_NAME"]="$CONTRACT_ID"

{
    echo "{"
    echo "  \"network\": \"$NETWORK\","
    echo "  \"deployed_at\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\","
    echo "  \"contracts\": {"
    first=true
    for c in "${CONTRACTS[@]}"; do
        if [ -n "${DEPLOYED_IDS[$c]:-}" ]; then
            if [ "$first" = true ]; then
                first=false
            else
                echo ","
            fi
            printf '    "%s": "%s"' "$c" "${DEPLOYED_IDS[$c]}"
        fi
    done
    echo ""
    echo "  }"
    echo "}"
} > "$OUTPUT_FILE"

echo "${GREEN}✓ Contract ID saved to: $OUTPUT_FILE${NC}" >&2

echo "$CONTRACT_ID"
