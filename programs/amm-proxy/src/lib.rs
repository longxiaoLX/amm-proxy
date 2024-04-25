pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
// pub use state::*;

declare_id!("3R9nqSqYpESEmo3chss8gEBpAAn1u6fY8QZyDFJRSyGS");

#[program]
pub mod amm_proxy {

    use super::*;

    /// Initiazlize a swap pool
    pub fn proxy_initialize(
        ctx: Context<ProxyInitialize>,
        nonce: u8,
        open_time: u64,
        init_pc_amount: u64,
        init_coin_amount: u64,
    ) -> Result<()> {
        initialize::ProxyInitialize::handler(
            ctx,
            nonce,
            open_time,
            init_pc_amount,
            init_coin_amount,
        )
    }

    /// deposit instruction
    pub fn proxy_deposit(
        ctx: Context<ProxyDeposit>,
        max_coin_amount: u64,
        max_pc_amount: u64,
        base_side: u64,
    ) -> Result<()> {
        deposit::ProxyDeposit::handler(ctx, max_coin_amount, max_pc_amount, base_side)
    }

    /// withdraw instruction
    pub fn proxy_withdraw(ctx: Context<ProxyWithdraw>, amount: u64) -> Result<()> {
        withdraw::ProxyWithdraw::handler(ctx, amount)
    }

    /// swap_base_in instruction
    pub fn proxy_swap_base_in(
        ctx: Context<ProxySwapBaseIn>,
        amount_in: u64,
        minimum_amount_out: u64,
    ) -> Result<()> {
        swap_base_in::ProxySwapBaseIn::handler(ctx, amount_in, minimum_amount_out)
    }

    /// swap_base_out instruction
    pub fn proxy_swap_base_out(
        ctx: Context<ProxySwapBaseOut>,
        max_amount_in: u64,
        amount_out: u64,
    ) -> Result<()> {
        swap_base_out::ProxySwapBaseOut::handler(ctx, max_amount_in, amount_out)
    }
}
