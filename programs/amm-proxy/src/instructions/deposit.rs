use amm_anchor::Deposit;
use anchor_lang::prelude::*;
use anchor_spl::token::Token;

#[derive(Accounts)]
pub struct ProxyDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Safe
    pub amm_program: UncheckedAccount<'info>,
    /// CHECK: Safe. The new amm Account to be create, a PDA create with seed = [program_id, openbook_market_id, b"amm_associated_seed"]
    #[account(mut)]
    pub amm: UncheckedAccount<'info>,
    /// CHECK: Safe. Amm authority, a PDA create with seed = [b"amm authority"]
    pub amm_authority: UncheckedAccount<'info>,
    /// CHECK: Safe. Amm open_orders Account, a PDA create with seed = [program_id, openbook_market_id, b"open_order_associated_seed"]
    #[account(mut)]
    pub amm_open_orders: UncheckedAccount<'info>,
    /// CHECK: Safe. AMM target orders account. To store plan orders infomations.
    #[account(mut)]
    pub amm_target_orders: UncheckedAccount<'info>,
    /// CHECK: Safe. LP mint account. Must be empty, owned by $authority.
    #[account(mut)]
    pub amm_lp_mint: UncheckedAccount<'info>,
    /// CHECK: Safe. amm_coin_vault account, $authority can transfer amount.
    #[account(mut)]
    pub amm_coin_vault: UncheckedAccount<'info>,
    /// CHECK: Safe. amm_pc_vault account, $authority can transfer amount.
    #[account(mut)]
    pub amm_pc_vault: UncheckedAccount<'info>,
    /// CHECK: Safe. OpenBook market account, OpenBook program is the owner.
    pub market: UncheckedAccount<'info>,
    /// CHECK: Safe. OpenBook market event queue account, OpenBook program is the owner.
    pub market_event_queue: UncheckedAccount<'info>,
    /// CHECK: Safe. User token coin to deposit into.
    #[account(mut)]
    pub user_token_coin: UncheckedAccount<'info>,
    /// CHECK: Safe. User token pc to deposit into.
    #[account(mut)]
    pub user_token_pc: UncheckedAccount<'info>,
    /// CHECK: Safe. User lp token, to deposit the generated tokens, user is the owner
    #[account(mut)]
    pub user_token_lp: UncheckedAccount<'info>,
    /// CHECK: Safe. User wallet account
    #[account(mut)]
    pub user_owner: Signer<'info>,
    /// CHECK: Safe. The spl token program
    pub token_program: Program<'info, Token>,
}

impl<'info> ProxyDeposit<'info> {
    pub fn handler(
        ctx: Context<ProxyDeposit>,
        max_coin_amount: u64,
        max_pc_amount: u64,
        base_side: u64,
    ) -> Result<()> {
        let cpi_accounts = Deposit {
            amm: ctx.accounts.amm.clone(),
            amm_authority: ctx.accounts.amm_authority.clone(),
            amm_open_orders: ctx.accounts.amm_open_orders.clone(),
            amm_target_orders: ctx.accounts.amm_target_orders.clone(),
            amm_lp_mint: ctx.accounts.amm_lp_mint.clone(),
            amm_coin_vault: ctx.accounts.amm_coin_vault.clone(),
            amm_pc_vault: ctx.accounts.amm_pc_vault.clone(),
            market: ctx.accounts.market.clone(),
            market_event_queue: ctx.accounts.market_event_queue.clone(),
            user_token_coin: ctx.accounts.user_token_coin.clone(),
            user_token_pc: ctx.accounts.user_token_pc.clone(),
            user_token_lp: ctx.accounts.user_token_lp.clone(),
            user_owner: ctx.accounts.user_owner.clone(),
            token_program: ctx.accounts.token_program.clone(),
        };
        let cpi_program = ctx.accounts.amm_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        amm_anchor::deposit(cpi_ctx, max_coin_amount, max_pc_amount, base_side)
    }
}
