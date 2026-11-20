#![no_std]

use shared_types::{
    is_admin, DriverPreferenceUpdatedEvent, EscrowContractUpdatedEvent,
    PendingPeerContractChange, StorageKey, TrustchainError,
};

// Settlement contract for cross-border currency swaps through an admin-configured router.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, Address, Env, IntoVal,
};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    EscrowContract,
    PendingEscrowContract,
    /// Admin-configured swap router used by `execute_settlement_swap`.
    SwapRouter,
    /// Per-driver preferred payout asset recorded via
    /// `set_driver_preference` (Issue #459).
    DriverPreference(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SettlementError {
    SwapNotImplemented = 1,
    SwapRouterNotConfigured = 2,
    InvalidSwapParameters = 3,
    SwapOutputBelowMinimum = 4,
    InsufficientSwapBalance = 5,
    SwapInputNotConsumed = 6,
    InvalidSwapDeadline = 7,
    /// The requested payout token does not implement the token interface.
    InvalidPreferenceToken = 8,
}

#[contract]
pub struct SettlementContract;

#[contractimpl]
impl SettlementContract {
    /// Initialize the settlement contract
    pub fn init(env: Env, admin: Address, escrow_contract: Address) {
        if env.storage().instance().has(&StorageKey::Admin) {
            panic_with_error!(&env, TrustchainError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&StorageKey::Admin, &admin);
        env.storage().instance().set(&DataKey::EscrowContract, &escrow_contract);
        env.storage()
            .instance()
            .extend_ttl(shared_types::ttl::LEDGER_TTL_THRESHOLD, shared_types::ttl::LEDGER_TTL_EXTEND_TO);
    }

    /// Get the settlement contract administrator.
    pub fn get_admin(env: Env) -> Address {
        env.storage()
            .instance()
            .extend_ttl(shared_types::ttl::LEDGER_TTL_THRESHOLD, shared_types::ttl::LEDGER_TTL_EXTEND_TO);
        env.storage()
            .instance()
            .get(&StorageKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, TrustchainError::NotInitialized))
    }

    /// Propose an escrow contract address. Admin only; it takes effect after
    /// a three-day review period and separate confirmation.
    ///
    /// Emits `escrow_contract_updated` so off-chain indexers can track
    /// escrow rotations (Issue #588).
    pub fn set_escrow_contract(env: Env, admin: Address, new_escrow: Address) {
        admin.require_auth();
        let stored_admin = env
            .storage()
            .instance()
            .get(&StorageKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, TrustchainError::NotInitialized));
        if admin != stored_admin {
            panic_with_error!(&env, TrustchainError::Unauthorized);
        }
        let activates_at = env
            .ledger()
            .timestamp()
            .saturating_add(shared_types::PEER_CONTRACT_CHANGE_TIMELOCK_SECONDS);
        env.storage().instance().set(
            &DataKey::PendingEscrowContract,
            &PendingPeerContractChange {
                address: new_escrow.clone(),
                proposed_by: admin.clone(),
                activates_at,
            },
        );
        env.storage()
            .instance()
            .extend_ttl(shared_types::ttl::LEDGER_TTL_THRESHOLD, shared_types::ttl::LEDGER_TTL_EXTEND_TO);

        env.events().publish(
            (soroban_sdk::Symbol::new(&env, "escrow_contract_change_proposed"),),
            (admin, new_escrow, activates_at),
        );
    }

    pub fn confirm_escrow_contract(env: Env) {
        let pending: PendingPeerContractChange = env
            .storage()
            .instance()
            .get(&DataKey::PendingEscrowContract)
            .unwrap_or_else(|| panic_with_error!(&env, TrustchainError::NoPendingContractChange));
        if env.ledger().timestamp() < pending.activates_at {
            panic_with_error!(&env, TrustchainError::ContractChangeTimelockNotElapsed);
        }
        env.storage()
            .instance()
            .set(&DataKey::EscrowContract, &pending.address);
        env.storage()
            .instance()
            .remove(&DataKey::PendingEscrowContract);
        env.storage()
            .instance()
            .extend_ttl(shared_types::ttl::LEDGER_TTL_THRESHOLD, shared_types::ttl::LEDGER_TTL_EXTEND_TO);
        env.events().publish(
            (shared_types::events::escrow_contract_updated(&env),),
            EscrowContractUpdatedEvent {
                admin: pending.proposed_by,
                new_escrow: pending.address,
            },
        );
    }

    pub fn get_pending_escrow_contract(env: Env) -> Option<PendingPeerContractChange> {
        env.storage()
            .instance()
            .get(&DataKey::PendingEscrowContract)
    }

    /// Get the configured escrow contract address.
    pub fn get_escrow_contract(env: Env) -> Address {
        env.storage()
            .instance()
            .extend_ttl(shared_types::ttl::LEDGER_TTL_THRESHOLD, shared_types::ttl::LEDGER_TTL_EXTEND_TO);
        env.storage()
            .instance()
            .get(&DataKey::EscrowContract)
            .unwrap_or_else(|| panic_with_error!(&env, TrustchainError::NotInitialized))
    }

    /// Set the trusted swap-router contract. Admin only.
    ///
    /// The router must implement `swap_exact_tokens_for_tokens` with the
    /// argument and return-value contract used by `execute_settlement_swap`.
    pub fn set_swap_router(env: Env, admin: Address, router: Address) {
        admin.require_auth();
        if !is_admin(&env, &admin) {
            panic_with_error!(&env, TrustchainError::Unauthorized);
        }
        env.storage().instance().set(&DataKey::SwapRouter, &router);
        env.storage().instance().extend_ttl(
            shared_types::ttl::LEDGER_TTL_THRESHOLD,
            shared_types::ttl::LEDGER_TTL_EXTEND_TO,
        );
    }

    /// Get the configured swap-router contract.
    pub fn get_swap_router(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::SwapRouter)
    }

    /// Record the asset a driver wants to be paid in.
    ///
    /// Any driver may set (or overwrite) their own preference; the caller must
    /// authenticate as the driver. Stored in persistent storage so the entry
    /// survives independently of the contract's instance entry, and both the
    /// preference and instance-entry TTLs are extended on every write (Issue #459).
    ///
    /// `to_token` must be a deployed contract implementing the token interface:
    /// it is probed via `decimals()` and `balance()` before anything is
    /// persisted, and anything else (an account address, a missing contract,
    /// or a non-token contract) is rejected with `InvalidPreferenceToken`, so
    /// a bad preference can never make later payouts revert.
    ///
    /// Emits `driver_preference_updated` so indexers can track preference
    /// changes (Issue #589).
    pub fn set_driver_preference(env: Env, driver: Address, to_token: Address) {
        driver.require_auth();
        if !is_token_contract(&env, &to_token) {
            panic_with_error!(&env, SettlementError::InvalidPreferenceToken);
        }
        let driver_clone = driver.clone();

        let key = DataKey::DriverPreference(driver);
        env.storage().persistent().set(&key, &to_token);
        env.storage().persistent().extend_ttl(
            &key,
            shared_types::ttl::LEDGER_TTL_THRESHOLD,
            shared_types::ttl::LEDGER_TTL_EXTEND_TO,
        );
        env.storage().instance().extend_ttl(
            shared_types::ttl::LEDGER_TTL_THRESHOLD,
            shared_types::ttl::LEDGER_TTL_EXTEND_TO,
        );

        env.events().publish(
            (shared_types::events::driver_preference_updated(&env),),
            DriverPreferenceUpdatedEvent {
                driver: driver_clone,
                target_token: to_token,
                timestamp: env.ledger().timestamp(),
            },
        );
    }

    /// Clear a driver's custom payout preference, routing settlements through
    /// the default native escrow token instead.
    ///
    /// Any driver may clear their own preference; the caller must authenticate
    /// as the driver (Issue #589).
    pub fn clear_driver_preference(env: Env, driver: Address) {
        driver.require_auth();
        let driver_clone = driver.clone();

        let key = DataKey::DriverPreference(driver);
        env.storage().persistent().remove(&key);

        env.events().publish(
            (shared_types::events::driver_preference_updated(&env),),
            DriverPreferenceUpdatedEvent {
                driver: driver_clone.clone(),
                target_token: driver_clone, // cleared → default routing
                timestamp: env.ledger().timestamp(),
            },
        );
    }

    /// Get driver's preferred asset for payment
    pub fn get_driver_preference(env: Env, driver: Address) -> Option<Address> {
        env.storage()
            .instance()
            .extend_ttl(shared_types::ttl::LEDGER_TTL_THRESHOLD, shared_types::ttl::LEDGER_TTL_EXTEND_TO);
        let key = DataKey::DriverPreference(driver);
        env.storage().persistent().get(&key)
    }

    /// Swap escrow-funded tokens through the configured router.
    ///
    /// The router is approved for exactly `amount` of `from_token` for the
    /// duration of the call, and that allowance is reset to zero as soon as
    /// the router returns. After a successful swap the router therefore holds
    /// no residual allowance; any failure reverts the approval with the rest
    /// of the transaction.
    pub fn execute_settlement_swap(
        env: Env,
        caller: Address,
        from_token: Address,
        to_token: Address,
        recipient: Address,
        amount: i128,
        min_amount_out: i128,
        deadline: u64,
    ) {
        caller.require_auth();

        env.storage()
            .instance()
            .extend_ttl(shared_types::ttl::LEDGER_TTL_THRESHOLD, shared_types::ttl::LEDGER_TTL_EXTEND_TO);

        let escrow_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::EscrowContract)
            .unwrap_or_else(|| panic_with_error!(&env, TrustchainError::NotInitialized));

        if caller != escrow_contract {
            panic_with_error!(&env, TrustchainError::Unauthorized);
        }

        let now = env.ledger().timestamp();
        if deadline < now
            || deadline > now.saturating_add(shared_types::SETTLEMENT_SWAP_DEADLINE_WINDOW_SECONDS)
        {
            panic_with_error!(&env, SettlementError::InvalidSwapDeadline);
        }

        if amount <= 0 || min_amount_out < 0 || from_token == to_token {
            panic_with_error!(&env, SettlementError::InvalidSwapParameters);
        }

        let router: Address = env
            .storage()
            .instance()
            .get(&DataKey::SwapRouter)
            .unwrap_or_else(|| panic_with_error!(&env, SettlementError::SwapRouterNotConfigured));

        let current_contract = env.current_contract_address();
        let input_token = soroban_sdk::token::Client::new(&env, &from_token);
        let balance_before = input_token.balance(&current_contract);
        if balance_before < amount {
            panic_with_error!(&env, SettlementError::InsufficientSwapBalance);
        }
        let expiration_ledger = env
            .ledger()
            .sequence()
            .checked_add(1)
            .unwrap_or_else(|| panic_with_error!(&env, SettlementError::InvalidSwapParameters));

        input_token.approve(&current_contract, &router, &amount, &expiration_ledger);

        let amount_out: i128 = env.invoke_contract(
            &router,
            &soroban_sdk::Symbol::new(&env, "swap_exact_tokens_for_tokens"),
            soroban_sdk::vec![
                &env,
                current_contract.into_val(&env),
                from_token.into_val(&env),
                to_token.into_val(&env),
                recipient.into_val(&env),
                amount.into_val(&env),
                min_amount_out.into_val(&env),
                deadline.into_val(&env),
            ],
        );

        // Revoke any residual allowance so the router never retains spend
        // rights over settlement funds once the swap returns, regardless of
        // how much of the approved amount it actually consumed.
        input_token.approve(&current_contract, &router, &0, &env.ledger().sequence());

        if amount_out < min_amount_out {
            panic_with_error!(&env, SettlementError::SwapOutputBelowMinimum);
        }
        if input_token.balance(&current_contract) != balance_before - amount {
            panic_with_error!(&env, SettlementError::SwapInputNotConsumed);
        }
    }
}

/// Probe `token` for the SEP-41 token interface used by settlement payouts.
///
/// Returns `false` if `token` is not a contract or if either probe call fails
/// or returns a value of the wrong type.
fn is_token_contract(env: &Env, token: &Address) -> bool {
    let client = soroban_sdk::token::TokenClient::new(env, token);
    let decimals_ok = matches!(client.try_decimals(), Ok(Ok(_)));
    decimals_ok && matches!(client.try_balance(&env.current_contract_address()), Ok(Ok(_)))
}

#[cfg(test)]
mod test;
