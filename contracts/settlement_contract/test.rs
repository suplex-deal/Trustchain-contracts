#![cfg(test)]

use super::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger as _},
    token, Address, Env,
};

#[contract]
struct MockSwapRouter;

#[contractimpl]
impl MockSwapRouter {
    pub fn swap_exact_tokens_for_tokens(
        env: Env,
        caller: Address,
        from_token: Address,
        to_token: Address,
        recipient: Address,
        amount: i128,
        _min_amount_out: i128,
        deadline: u64,
    ) -> i128 {
        let now = env.ledger().timestamp();
        if deadline < now
            || deadline > now.saturating_add(shared_types::SETTLEMENT_SWAP_DEADLINE_WINDOW_SECONDS)
        {
            panic!("invalid swap deadline");
        }
        let router = env.current_contract_address();
        token::Client::new(&env, &from_token).transfer_from(&router, &caller, &router, &amount);
        let amount_out = amount * 2;
        token::Client::new(&env, &to_token).transfer(&router, &recipient, &amount_out);
        amount_out
    }
}

#[test]
fn test_get_driver_preference_returns_none_when_unset() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let driver = Address::generate(&env);

    // No preference has been recorded yet, so the getter must return None.
    assert_eq!(client.get_driver_preference(&driver), None);
}

/// Issue #459: a driver records their preferred payout asset on-chain and the
/// getter reads it back.
#[test]
fn test_set_and_get_driver_preference() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let driver = Address::generate(&env);
    let to_token = Address::generate(&env);

    client.set_driver_preference(&driver, &to_token);

    assert_eq!(
        client.get_driver_preference(&driver),
        Some(to_token.clone())
    );
}

#[test]
fn test_set_driver_preference_extends_instance_ttl() {
    use soroban_sdk::testutils::Deployer as _;

    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let escrow = Address::generate(&env);
    let driver = Address::generate(&env);
    let to_token = Address::generate(&env);

    client.init(&admin, &escrow);
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number += shared_types::ttl::LEDGER_TTL_EXTEND_TO - 10;
    });

    client.set_driver_preference(&driver, &to_token);

    let instance_ttl = env.deployer().get_contract_instance_ttl(&contract_id);
    assert!(
        instance_ttl >= shared_types::ttl::LEDGER_TTL_THRESHOLD,
        "set_driver_preference must extend the contract instance TTL (got {instance_ttl})"
    );
}

/// Preferences are per driver: setting one must not leak into another's record.
#[test]
fn test_driver_preference_is_scoped_per_driver() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let driver_a = Address::generate(&env);
    let driver_b = Address::generate(&env);
    let token_a = Address::generate(&env);
    let token_b = Address::generate(&env);

    client.set_driver_preference(&driver_a, &token_a);
    client.set_driver_preference(&driver_b, &token_b);

    assert_eq!(client.get_driver_preference(&driver_a), Some(token_a));
    assert_eq!(client.get_driver_preference(&driver_b), Some(token_b));
}

/// Setting a preference is an overwrite, so a driver can change their mind.
#[test]
fn test_set_driver_preference_overwrites_previous_value() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let driver = Address::generate(&env);
    let first = Address::generate(&env);
    let second = Address::generate(&env);

    client.set_driver_preference(&driver, &first);
    client.set_driver_preference(&driver, &second);

    assert_eq!(client.get_driver_preference(&driver), Some(second));
}

/// The preference write must be authorised by the driver whose record is
/// written, so a caller whose signature is not authorized cannot set it.
#[test]
fn test_set_driver_preference_requires_driver_auth() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let driver = Address::generate(&env);
    let to_token = Address::generate(&env);

    // No auth is mocked, so the driver's own signature is missing.
    let result = client.try_set_driver_preference(&driver, &to_token);
    assert!(result.is_err());

    assert_eq!(client.get_driver_preference(&driver), None);
}

/// Issue #588: set_escrow_contract requires admin auth and updates the escrow
/// address; get_escrow_contract reads it back.
#[test]
fn test_set_and_get_escrow_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let new_escrow = Address::generate(&env);

    // Initialize first so there is an admin.
    client.init(&admin, &new_escrow);

    // get_escrow_contract returns the address set at init.
    assert_eq!(client.get_escrow_contract(), new_escrow);

    // Update to a new escrow address.
    let newer_escrow = Address::generate(&env);
    client.set_escrow_contract(&admin, &newer_escrow);
    env.ledger().set_timestamp(
        env.ledger().timestamp() + shared_types::PEER_CONTRACT_CHANGE_TIMELOCK_SECONDS,
    );
    client.confirm_escrow_contract();
    assert_eq!(client.get_escrow_contract(), newer_escrow);
}

/// Issue #588: set_escrow_contract is restricted to admin.
#[test]
fn test_set_escrow_contract_requires_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let new_escrow = Address::generate(&env);

    client.init(&admin, &new_escrow);

    let result = client.try_set_escrow_contract(&non_admin, &new_escrow);
    assert!(result.is_err());
}

// ── init / get_admin coverage ──────────────────────────────────────────────

/// init stores the admin and the initial escrow contract; get_admin and
/// get_escrow_contract read them back.
#[test]
fn test_init_stores_admin_and_escrow_contract() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let escrow = Address::generate(&env);

    client.init(&admin, &escrow);

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_escrow_contract(), escrow);
}

/// A second init must be rejected with AlreadyInitialized so neither the
/// admin nor the escrow address can be silently overwritten.
#[test]
fn test_init_rejects_duplicate_initialization() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let escrow = Address::generate(&env);
    client.init(&admin, &escrow);

    let hijacker = Address::generate(&env);
    let hijacked_escrow = Address::generate(&env);
    let result = client.try_init(&hijacker, &hijacked_escrow);
    match result {
        Err(Ok(err)) => assert_eq!(err, TrustchainError::AlreadyInitialized.into()),
        _ => panic!("Expected AlreadyInitialized on duplicate init"),
    }

    // The original state survived the attempted re-initialization.
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_escrow_contract(), escrow);
}

/// get_admin before init fails with NotInitialized instead of returning a
/// zeroed or garbage address.
#[test]
fn test_get_admin_before_init_returns_not_initialized() {
    let env = Env::default();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let result = client.try_get_admin();
    match result {
        Err(Ok(err)) => assert_eq!(err, TrustchainError::NotInitialized.into()),
        _ => panic!("Expected NotInitialized from get_admin before init"),
    }
}

// ── execute_settlement_swap production guard ───────────────────────────────

/// Calling the stub before init fails with NotInitialized rather than
/// proceeding with no escrow contract configured.
#[test]
fn test_execute_settlement_swap_requires_initialization() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let caller = Address::generate(&env);
    let token = Address::generate(&env);
    let recipient = Address::generate(&env);

    let result =
        client.try_execute_settlement_swap(&caller, &token, &token, &recipient, &100i128, &90i128);
    match result {
        Err(Ok(err)) => assert_eq!(err, TrustchainError::NotInitialized.into()),
        _ => panic!("Expected NotInitialized from un-initialized execute_settlement_swap"),
    }
}

/// Only the configured escrow contract may call execute_settlement_swap; any
/// other caller is rejected with Unauthorized before the stub guard fires.
///
/// Note: `TrustchainError::Unauthorized` and `SettlementError::SwapNotImplemented`
/// share wire discriminant #1 because this contract mixes the shared error
/// enum with its local one, so this assertion pins the discriminant rather
/// than being able to tell the two variants apart on the wire.
#[test]
fn test_execute_settlement_swap_rejects_non_escrow_caller() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let escrow = Address::generate(&env);
    client.init(&admin, &escrow);

    let intruder = Address::generate(&env);
    let token = Address::generate(&env);
    let recipient = Address::generate(&env);

    let result = client
        .try_execute_settlement_swap(&intruder, &token, &token, &recipient, &100i128, &90i128);
    match result {
        Err(Ok(err)) => assert_eq!(err, TrustchainError::Unauthorized.into()),
        _ => panic!("Expected Unauthorized for a non-escrow caller"),
    }
}

/// The Phase 3 guard: even the authorized escrow caller hits the
/// SwapNotImplemented panic — this stub must never silently no-op on mainnet
/// with unimplemented settlement logic.
#[test]
fn test_execute_settlement_swap_panics_before_phase_3() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let escrow = Address::generate(&env);
    client.init(&admin, &escrow);

    let token = Address::generate(&env);
    let recipient = Address::generate(&env);

    let result =
        client.try_execute_settlement_swap(&escrow, &token, &token, &recipient, &100i128, &90i128);
    match result {
        Err(Ok(err)) => assert_eq!(err, SettlementError::SwapNotImplemented.into()),
        _ => panic!("Expected SwapNotImplemented production guard"),
    }
}

/// Issue #589: clear_driver_preference removes the preference.
#[test]
fn test_clear_driver_preference_removes() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let driver = Address::generate(&env);
    let to_token = Address::generate(&env);

    client.set_driver_preference(&driver, &to_token);
    assert_eq!(client.get_driver_preference(&driver), Some(to_token.clone()));

    client.clear_driver_preference(&driver);
    assert_eq!(client.get_driver_preference(&driver), None);
}

#[test]
fn test_execute_settlement_swap_uses_configured_router() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let escrow = Address::generate(&env);
    let router = env.register_contract(None, MockSwapRouter);
    let input_admin = Address::generate(&env);
    let output_admin = Address::generate(&env);
    let from_token = env
        .register_stellar_asset_contract_v2(input_admin.clone())
        .address();
    let to_token = env
        .register_stellar_asset_contract_v2(output_admin.clone())
        .address();
    let recipient = Address::generate(&env);

    client.init(&admin, &escrow);
    client.set_swap_router(&admin, &router);
    token::StellarAssetClient::new(&env, &from_token).mint(&contract_id, &100);
    token::StellarAssetClient::new(&env, &to_token).mint(&router, &200);

    client.execute_settlement_swap(
        &escrow,
        &from_token,
        &to_token,
        &recipient,
        &100,
        &190,
        &300,
    );

    assert_eq!(token::Client::new(&env, &to_token).balance(&recipient), 200);
    assert_eq!(token::Client::new(&env, &from_token).balance(&router), 100);
}

#[test]
fn test_execute_settlement_swap_rejects_deadline_beyond_window() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let escrow = Address::generate(&env);
    let from_token = Address::generate(&env);
    let to_token = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.init(&admin, &escrow);
    env.ledger().set_timestamp(100);

    let too_far = client.try_execute_settlement_swap(
        &escrow,
        &from_token,
        &to_token,
        &recipient,
        &100,
        &90,
        &(100 + shared_types::SETTLEMENT_SWAP_DEADLINE_WINDOW_SECONDS + 1),
    );
    assert!(too_far.is_err());

    let expired = client.try_execute_settlement_swap(
        &escrow,
        &from_token,
        &to_token,
        &recipient,
        &100,
        &90,
        &99,
    );
    assert!(expired.is_err());
}

// ── Issue #132 — swap_router_updated event ────────────────────────────────────

/// set_swap_router emits a swap_router_updated event with admin, old router
/// (None on first set), and new router (Issue #132).
#[test]
fn test_set_swap_router_emits_event_first_time() {
    use soroban_sdk::{
        testutils::Events,
        xdr::ContractEventBody,
        TryFromVal,
    };
    use shared_types::SwapRouterUpdatedEvent;

    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let escrow = Address::generate(&env);
    client.init(&admin, &escrow);

    let router = Address::generate(&env);
    client.set_swap_router(&admin, &router);

    // Decode the last event.
    let events = env.events().all();
    let raw = events.events().last().expect("no events emitted").clone();
    let ContractEventBody::V0(body) = raw.body;

    let topic0: Symbol =
        Symbol::try_from_val(&env, body.topics.get(0).unwrap()).expect("topic decode");
    assert_eq!(topic0, Symbol::new(&env, "swap_router_updated"));

    let data: SwapRouterUpdatedEvent =
        SwapRouterUpdatedEvent::try_from_val(&env, &body.data).expect("data decode");
    assert_eq!(data.admin, admin);
    assert_eq!(data.old_router, None);
    assert_eq!(data.new_router, router);
}

/// A second call to set_swap_router emits the event with the previous router
/// as old_router and the new one as new_router.
#[test]
fn test_set_swap_router_emits_event_with_old_router() {
    use soroban_sdk::{
        testutils::Events,
        xdr::ContractEventBody,
        TryFromVal,
    };
    use shared_types::SwapRouterUpdatedEvent;

    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let escrow = Address::generate(&env);
    client.init(&admin, &escrow);

    let first_router = Address::generate(&env);
    let second_router = Address::generate(&env);

    client.set_swap_router(&admin, &first_router);
    client.set_swap_router(&admin, &second_router);

    // Decode the last event (from the second set_swap_router call).
    let events = env.events().all();
    let raw = events.events().last().expect("no events emitted").clone();
    let ContractEventBody::V0(body) = raw.body;

    let topic0: Symbol =
        Symbol::try_from_val(&env, body.topics.get(0).unwrap()).expect("topic decode");
    assert_eq!(topic0, Symbol::new(&env, "swap_router_updated"));

    let data: SwapRouterUpdatedEvent =
        SwapRouterUpdatedEvent::try_from_val(&env, &body.data).expect("data decode");
    assert_eq!(data.admin, admin);
    assert_eq!(data.old_router, Some(first_router));
    assert_eq!(data.new_router, second_router);
}

/// set_swap_router is restricted to the contract admin.
#[test]
fn test_set_swap_router_requires_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let escrow = Address::generate(&env);
    client.init(&admin, &escrow);

    let non_admin = Address::generate(&env);
    let router = Address::generate(&env);

    let result = client.try_set_swap_router(&non_admin, &router);
    match result {
        Err(Ok(err)) => assert_eq!(err, TrustchainError::Unauthorized.into()),
        _ => panic!("Expected Unauthorized for non-admin set_swap_router"),
    }

    // No router must have been set.
    assert_eq!(client.get_swap_router(), None);
}

/// After a successful set_swap_router the getter returns the stored address.
#[test]
fn test_set_swap_router_stores_and_returns_router() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SettlementContract);
    let client = SettlementContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let escrow = Address::generate(&env);
    client.init(&admin, &escrow);

    let router = Address::generate(&env);
    client.set_swap_router(&admin, &router);

    assert_eq!(client.get_swap_router(), Some(router));
}

