#!/bin/bash

# Trustchain-contracts - Single Contract Deployment Script
# Usage: ./deploy-contract.sh <contract_name> [network]

set -e

CONTRACT_NAME=$1
NETWORK=${2:-testnet}
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
    echo "   cargo install --locked stellar-cli --version 21.5.0" >&2
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
echo "${BLUE}Building $CONTRACT_NAME...${NC}" >&2
cd "$PROJECT_ROOT"
cargo build --target wasm32v1-none --release -p "$CONTRACT_NAME"
echo "${GREEN}✓ Build successful${NC}" >&2
echo "" >&2

WASM_PATH="$PROJECT_ROOT/target/wasm32v1-none/release/${CONTRACT_NAME}.wasm"

if [ ! -f "$WASM_PATH" ]; then
    echo "${RED}❌ WASM file not found: $WASM_PATH${NC}" >&2
    exit 1
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

# Post-deployment verification (#97): read back the WASM that is actually
# live on-chain for the newly deployed contract ID and hash it, instead of
# trusting that `stellar contract deploy` exiting 0 means the deployed code
# matches what we just built. A mismatch here means the deploy did not take
# effect the way we think it did (wrong network, stale CLI, RPC lag, etc.).
echo "${BLUE}Verifying on-chain WASM for $CONTRACT_NAME...${NC}" >&2
LOCAL_WASM_SHA256=$(sha256sum "$WASM_PATH" | awk '{print $1}')

VERIFY_DIR=$(mktemp -d)
trap 'rm -rf "$VERIFY_DIR"' EXIT
DEPLOYED_WASM_PATH="$VERIFY_DIR/${CONTRACT_NAME}.deployed.wasm"

if ! stellar contract fetch --id "$CONTRACT_ID" --network "$NETWORK" -o "$DEPLOYED_WASM_PATH" &> /dev/null; then
    echo "${RED}❌ Could not fetch on-chain WASM for $CONTRACT_ID to verify the deploy.${NC}" >&2
    exit 1
fi

DEPLOYED_WASM_SHA256=$(sha256sum "$DEPLOYED_WASM_PATH" | awk '{print $1}')

if [ "$LOCAL_WASM_SHA256" != "$DEPLOYED_WASM_SHA256" ]; then
    echo "${RED}❌ Deployed WASM hash mismatch for $CONTRACT_NAME!${NC}" >&2
    echo "   Built locally:   $LOCAL_WASM_SHA256" >&2
    echo "   Live on $NETWORK: $DEPLOYED_WASM_SHA256" >&2
    echo "   The contract ID returned by 'stellar contract deploy' does not" >&2
    echo "   currently serve the code we just built. Treat this deploy as" >&2
    echo "   failed; do not record $CONTRACT_ID as the deployed address." >&2
    exit 1
fi
echo "${GREEN}✓ On-chain WASM hash matches the local build ($LOCAL_WASM_SHA256)${NC}" >&2

# Verify against a known-good release manifest, if one was supplied (#96).
# RELEASE_WASM_SHA256SUMS points at a SHA256SUMS.txt produced by
# .github/workflows/release.yml (the "Generate Checksums" step). If the
# manifest records a hash for this contract, the just-deployed WASM must
# match it exactly, catching a stale/mismatched deploy that used a build
# artifact other than the one tagged for this release.
if [ -n "${RELEASE_WASM_SHA256SUMS:-}" ]; then
    if [ ! -f "$RELEASE_WASM_SHA256SUMS" ]; then
        echo "${RED}❌ RELEASE_WASM_SHA256SUMS is set but file not found: $RELEASE_WASM_SHA256SUMS${NC}" >&2
        exit 1
    fi
    EXPECTED_SHA256=$(grep -E "  ${CONTRACT_NAME}\.wasm\$" "$RELEASE_WASM_SHA256SUMS" | awk '{print $1}')
    if [ -z "$EXPECTED_SHA256" ]; then
        echo "${YELLOW}⚠ No entry for ${CONTRACT_NAME}.wasm in $RELEASE_WASM_SHA256SUMS; skipping release-hash check.${NC}" >&2
    elif [ "$EXPECTED_SHA256" != "$DEPLOYED_WASM_SHA256" ]; then
        echo "${RED}❌ Deployed WASM hash does not match the release artifact for $CONTRACT_NAME!${NC}" >&2
        echo "   Release manifest ($RELEASE_WASM_SHA256SUMS): $EXPECTED_SHA256" >&2
        echo "   Deployed on $NETWORK:                        $DEPLOYED_WASM_SHA256" >&2
        echo "   This deploy does not correspond to the released build. Do not" >&2
        echo "   record $CONTRACT_ID as the deployed address for this release." >&2
        exit 1
    else
        echo "${GREEN}✓ Deployed WASM hash matches the release artifact ($EXPECTED_SHA256)${NC}" >&2
    fi
fi

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
