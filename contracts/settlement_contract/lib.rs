#![no_std]

use shared_types::{
    is_admin, DriverPreferenceUpdatedEvent, EscrowContractUpdatedEvent, TrustchainError,
    PendingPeerContractChange, SettlementSwapExecutedEvent, StorageKey,
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
    SwapRouter,
    /// Per-driver preferred payout asset recorded via
    /// `set_driver_preference` (Issue #459).
    DriverPreference(Address),
    /// Receipt for a completed swap, keyed by the escrow contract that
    /// requested it and that escrow's delivery ID. Its presence makes each
    /// escrow record settleable through this contract at most once.
    SwapReceipt(Address, u64),
}

/// Persistent record of a completed settlement swap.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SwapReceipt {
    pub driver: Address,
    pub recipient: Address,
    pub from_token: Address,
    pub to_token: Address,
    pub amount_in: i128,
    pub amount_out: i128,
    pub settled_at: u64,
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
    /// `to_token` does not match the driver's own recorded preference.
    PreferenceMismatch = 8,
    /// Recipient is the settlement contract, the router, or the escrow caller.
    InvalidSwapRecipient = 9,
    /// A swap for this `(escrow, delivery_id)` has already been settled.
    SwapAlreadySettled = 10,
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
    /// Emits `driver_preference_updated` so indexers can track preference
    /// changes (Issue #589).
    pub fn set_driver_preference(env: Env, driver: Address, to_token: Address) {
        driver.require_auth();
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

    /// Return the receipt of a completed swap for `(escrow, delivery_id)`.
    pub fn get_swap_receipt(env: Env, escrow: Address, delivery_id: u64) -> Option<SwapReceipt> {
        env.storage()
            .persistent()
            .get(&DataKey::SwapReceipt(escrow, delivery_id))
    }

    /// Swap escrow-funded tokens through the configured router.
    ///
    /// The `amount` of `from_token` is pulled from `caller` (the escrow) at
    /// the start of the swap, so the escrow must authorize that transfer as a
    /// sub-invocation (see `escrow_contract::payout_driver`).
    ///
    /// `delivery_id` identifies the escrow record this swap pays out. It is
    /// supplied by `caller`, which must authenticate and must be the
    /// configured escrow contract, so the identifier is attributable to the
    /// escrow that holds the record rather than to an arbitrary third party.
    ///
    /// # Binding and trust boundary
    ///
    /// Settlement independently enforces, without trusting the escrow:
    /// - `to_token` equals the preference `driver` recorded themselves via
    ///   `set_driver_preference` (driver-signed), so funds cannot be
    ///   converted into an asset the driver never asked for;
    /// - `recipient` is not this contract, the router, or the escrow caller;
    /// - each `(caller, delivery_id)` settles at most once (receipt stored).
    ///
    /// Resolving *which* address receives a driver's payout (the driver, a
    /// fleet treasury, or a payout address snapshotted at escrow creation) is
    /// escrow state that settlement cannot read during the call (Soroban
    /// forbids re-entering the escrow), so `recipient` is trusted to the
    /// configured escrow. That trust is scoped to the currently confirmed
    /// escrow address: a rotation only takes effect after the
    /// `PEER_CONTRACT_CHANGE_TIMELOCK_SECONDS` review period, and the
    /// previous escrow is rejected as soon as the new one is confirmed.
    ///
    /// On success, publishes `settlement_swap_executed` with the token pair,
    /// recipient, consumed input, measured output and escrow reference, and
    /// returns the measured output amount.
    pub fn execute_settlement_swap(
        env: Env,
        caller: Address,
        delivery_id: u64,
        driver: Address,
        from_token: Address,
        to_token: Address,
        recipient: Address,
        amount: i128,
        min_amount_out: i128,
        deadline: u64,
    ) -> i128 {
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

        let receipt_key = DataKey::SwapReceipt(caller.clone(), delivery_id);
        if env.storage().persistent().has(&receipt_key) {
            panic_with_error!(&env, SettlementError::SwapAlreadySettled);
        }

        let preference: Option<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::DriverPreference(driver.clone()));
        if preference.as_ref() != Some(&to_token) {
            panic_with_error!(&env, SettlementError::PreferenceMismatch);
        }

        let router: Address = env
            .storage()
            .instance()
            .get(&DataKey::SwapRouter)
            .unwrap_or_else(|| panic_with_error!(&env, SettlementError::SwapRouterNotConfigured));

        let current_contract = env.current_contract_address();
        if recipient == current_contract || recipient == router || recipient == caller {
            panic_with_error!(&env, SettlementError::InvalidSwapRecipient);
        }

        // Pull the input from the escrow inside this call frame. If anything
        // below fails, the whole frame — including this transfer — is rolled
        // back, so a failed swap can never strand escrow funds here. The
        // escrow pre-authorizes exactly this transfer.
        let input_token = soroban_sdk::token::Client::new(&env, &from_token);
        input_token.transfer(&caller, &current_contract, &amount);
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

        let output_token = soroban_sdk::token::Client::new(&env, &to_token);
        let recipient_out_before = output_token.balance(&recipient);

        let reported_amount_out: i128 = env.invoke_contract(
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
        if input_token.balance(&current_contract) != balance_before - amount {
            panic_with_error!(&env, SettlementError::SwapInputNotConsumed);
        }
        // Measure what the recipient actually received instead of trusting
        // the router's return value; both must clear the slippage floor.
        let amount_out = output_token
            .balance(&recipient)
            .checked_sub(recipient_out_before)
            .unwrap_or_else(|| panic_with_error!(&env, SettlementError::InvalidSwapParameters));
        if amount_out < min_amount_out || reported_amount_out < min_amount_out {
            panic_with_error!(&env, SettlementError::SwapOutputBelowMinimum);
        }

        env.storage().persistent().set(
            &receipt_key,
            &SwapReceipt {
                driver: driver.clone(),
                recipient: recipient.clone(),
                from_token: from_token.clone(),
                to_token: to_token.clone(),
                amount_in: amount,
                amount_out,
                settled_at: now,
            },
        );
        env.storage().persistent().extend_ttl(
            &receipt_key,
            shared_types::ttl::LEDGER_TTL_THRESHOLD,
            shared_types::ttl::LEDGER_TTL_EXTEND_TO,
        );

        env.events().publish(
            (shared_types::events::settlement_swap_executed(&env),),
            SettlementSwapExecutedEvent {
                escrow_contract: caller,
                delivery_id,
                driver,
                from_token,
                to_token,
                recipient,
                amount_in: amount,
                amount_out,
            },
        );

        amount_out
    }
}

#[cfg(test)]
mod test;
