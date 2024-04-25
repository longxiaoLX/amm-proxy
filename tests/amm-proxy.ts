import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AmmProxy } from "../target/types/amm_proxy";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  Liquidity,
  LiquidityAssociatedPoolKeys,
} from "@raydium-io/raydium-sdk"
import {
  Market,
  buildOptimalTransaction,
  createMarket,
  createMintPair,
  getMarket
} from "./util";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
  Account as TokenAccount,
} from "@solana/spl-token";

const globalInfo = {
  // devnet: EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj
  // mainnet: srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX
  marketProgram: new PublicKey("EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj"),
  // devnet: HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8
  // mainnet: 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8
  ammProgram: new PublicKey("HWy1jotHpo6UqeQxx49dpYYdQB8wj9Qk9MdxwjLvDHB8"),
  // devnet: 3XMrhbv989VxAMi3DErLV9eJht1pHppW5LbKxe9fkEFR
  // mainnet: 7YttLkHDoNj9wyDur5pM1ejNaAvT9X4eqaYcHQqtj2G5
  ammCreateFeeDestination: new PublicKey("3XMrhbv989VxAMi3DErLV9eJht1pHppW5LbKxe9fkEFR"),
  market: new Keypair(),
}

const confirmOptions = {
  skipPreflight: true,
}

describe("amm-proxy", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const owner = anchor.Wallet.local().payer;
  const program = anchor.workspace.AmmProxy as Program<AmmProxy>;
  const conn = anchor.getProvider().connection;
  const marketId = globalInfo.market.publicKey.toString();
  console.log(`market is ${marketId}`);

  let tokenAMint: PublicKey;
  let tokenBMint: PublicKey;
  let poolKeys: LiquidityAssociatedPoolKeys;
  let userCoinTokenAccount: TokenAccount;
  let userPcTokenAccount: TokenAccount;
  let userLPTokenAccount: PublicKey;
  let market: Market;

  before(async () => {
    let { tokenA: tokenALocal, tokenB: tokenBLocal } = await createMintPair(conn, owner);
    tokenAMint = tokenALocal;
    tokenBMint = tokenBLocal;
    // create serum market
    await createMarket({
      connection: conn,
      payer: owner,
      baseMint: tokenAMint,
      quoteMint: tokenBMint,
      baseLotSize: 1,
      quoteLotSize: 1,
      dexProgram: globalInfo.marketProgram,
      market: globalInfo.market,
    });

    // get serum market info
    market = await getMarket(
      conn,
      globalInfo.market.publicKey,
      globalInfo.marketProgram
    );
    // console.log("market info:", JSON.stringify(market));

    // 获取与池子相关的 keys
    poolKeys = Liquidity.getAssociatedPoolKeys({
      version: 4,
      marketVersion: 3,
      marketId: globalInfo.market.publicKey,
      baseMint: market.baseMint,
      quoteMint: market.quoteMint,
      baseDecimals: 9,
      quoteDecimals: 9,
      programId: globalInfo.ammProgram,
      marketProgramId: globalInfo.marketProgram,
    });
    // console.log("amm poolKeys: ", JSON.stringify(poolKeys));

    userCoinTokenAccount = await getOrCreateAssociatedTokenAccount(
      conn,
      owner,
      market.baseMint,
      owner.publicKey,
    );
    userPcTokenAccount = await getOrCreateAssociatedTokenAccount(
      conn,
      owner,
      market.quoteMint,
      owner.publicKey,
    );
    userLPTokenAccount = getAssociatedTokenAddressSync(
      poolKeys.lpMint,
      owner.publicKey,
    );
  });

  it("proxy initialize", async () => {
    let ix = await program.methods
      .proxyInitialize(
        poolKeys.nonce,
        new anchor.BN(0),
        new anchor.BN(1000000000), // set as you want
        new anchor.BN(2000000000), // set as you want
      )
      .accountsStrict({
        payer: owner.publicKey,
        ammProgram: globalInfo.ammProgram,
        amm: poolKeys.id,
        ammAuthority: poolKeys.authority,
        ammOpenOrders: poolKeys.openOrders,
        ammLpMint: poolKeys.lpMint,
        ammCoinMint: poolKeys.baseMint,
        ammPcMint: poolKeys.quoteMint,
        ammCoinVault: poolKeys.baseVault,
        ammPcVault: poolKeys.quoteVault,
        ammTargetOrders: poolKeys.targetOrders,
        ammConfig: poolKeys.configId,
        createFeeDestination: globalInfo.ammCreateFeeDestination,
        marketProgram: globalInfo.marketProgram,
        market: globalInfo.market.publicKey,
        userWallet: owner.publicKey,
        userTokenCoin: userCoinTokenAccount.address,
        userTokenPc: userPcTokenAccount.address,
        userTokenLp: userLPTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        sysvarRent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    let txResult = await buildOptimalTransaction({
      connection: conn,
      instructions: [ix],
      payer: owner.publicKey,
      lookupTables: [],
    });

    txResult.transaction.sign([owner]);
    let txsig = await conn.sendTransaction(txResult.transaction, confirmOptions);
    await conn.confirmTransaction(
      {
        blockhash: txResult.recentBlockhash.blockhash,
        lastValidBlockHeight: txResult.recentBlockhash.lastValidBlockHeight,
        signature: txsig,
      },
      "finalized",
    );

    console.log(`initialize tx: ${txsig}`);
  });

  it("proxy deposit", async () => {
    let ix = await program.methods
      .proxyDeposit(
        new anchor.BN(1000000000), // maxCoinAmount
        new anchor.BN(3000000000), // maxPcAmount
        new anchor.BN(0) // baseSide?
      )
      .accountsStrict({
        payer: owner.publicKey,
        ammProgram: globalInfo.ammProgram,
        amm: poolKeys.id,
        ammAuthority: poolKeys.authority,
        ammOpenOrders: poolKeys.openOrders,
        ammTargetOrders: poolKeys.targetOrders,
        ammLpMint: poolKeys.lpMint,
        ammCoinVault: poolKeys.baseVault,
        ammPcVault: poolKeys.quoteVault,
        market: globalInfo.market.publicKey,
        marketEventQueue: market.eventQueue,
        userTokenCoin: userCoinTokenAccount.address,
        userTokenPc: userPcTokenAccount.address,
        userTokenLp: userLPTokenAccount,
        userOwner: owner.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    let txResult = await buildOptimalTransaction({
      connection: conn,
      instructions: [ix],
      payer: owner.publicKey,
      lookupTables: [],
    })

    txResult.transaction.sign([owner]);
    let txsig = await conn.sendTransaction(txResult.transaction, confirmOptions);
    await conn.confirmTransaction(
      {
        blockhash: txResult.recentBlockhash.blockhash,
        lastValidBlockHeight: txResult.recentBlockhash.lastValidBlockHeight,
        signature: txsig,
      },
      "finalized",
    );

    console.log(`deposit tx: ${txsig}`);
  });

  it("proxy withdraw", async () => {
    let ix = await program.methods
      .proxyWithdraw(
        new anchor.BN(10) // lpAmount
      )
      .accountsStrict({
        payer: owner.publicKey,
        ammProgram: globalInfo.ammProgram,
        amm: poolKeys.id,
        ammAuthority: poolKeys.authority,
        ammOpenOrders: poolKeys.openOrders,
        ammTargetOrders: poolKeys.targetOrders,
        ammLpMint: poolKeys.lpMint,
        ammCoinVault: poolKeys.baseVault,
        ammPcVault: poolKeys.quoteVault,
        marketProgram: globalInfo.marketProgram,
        market: globalInfo.market.publicKey,
        marketCoinVault: market.baseVault,
        marketPcVault: market.quoteVault,
        marketVaultSigner: market.vaultOwner,
        userTokenLp: userLPTokenAccount,
        userTokenCoin: userCoinTokenAccount.address,
        userTokenPc: userPcTokenAccount.address,
        userOwner: owner.publicKey,
        marketEventQ: market.eventQueue,
        marketBids: market.bids,
        marketAsks: market.asks,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    let txResult = await buildOptimalTransaction({
      connection: conn,
      instructions: [ix],
      payer: owner.publicKey,
      lookupTables: [],
    });

    txResult.transaction.sign([owner]);
    let txsig = await conn.sendTransaction(txResult.transaction, confirmOptions);
    await conn.confirmTransaction(
      {
        blockhash: txResult.recentBlockhash.blockhash,
        lastValidBlockHeight: txResult.recentBlockhash.lastValidBlockHeight,
        signature: txsig,
      },
      "finalized",
    );

    console.log(`withdraw tx: ${txsig}`);
  });

  it("proxy swap base in", async () => {
    let ix = await program.methods
      .proxySwapBaseIn(
        new anchor.BN(10000), // amountIn
        new anchor.BN(1), // amountOut
      )
      .accountsStrict({
        payer: owner.publicKey,
        ammProgram: globalInfo.ammProgram,
        amm: poolKeys.id,
        ammAuthority: poolKeys.authority,
        ammOpenOrders: poolKeys.openOrders,
        ammCoinVault: poolKeys.baseVault,
        ammPcVault: poolKeys.quoteVault,
        marketProgram: globalInfo.marketProgram,
        market: globalInfo.market.publicKey,
        marketBids: market.bids,
        marketAsks: market.asks,
        marketEventQueue: market.eventQueue,
        marketCoinVault: market.baseVault,
        marketPcVault: market.quoteVault,
        marketVaultSigner: market.vaultOwner,
        userTokenSource: userCoinTokenAccount.address,
        userTokenDestination: userPcTokenAccount.address,
        userSourceOwner: owner.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    let txResult = await buildOptimalTransaction({
      connection: conn,
      instructions: [ix],
      payer: owner.publicKey,
      lookupTables: [],
    });

    txResult.transaction.sign([owner]);
    let txsig = await conn.sendTransaction(txResult.transaction, confirmOptions);
    await conn.confirmTransaction(
      {
        blockhash: txResult.recentBlockhash.blockhash,
        lastValidBlockHeight: txResult.recentBlockhash.lastValidBlockHeight,
        signature: txsig,
      },
      "finalized",
    );

    console.log(`swap base in tx: ${txsig}`);
  });

  it("proxy swap base out", async () => {
    let ix = await program.methods
      .proxySwapBaseOut(
        new anchor.BN(10000), // max_amount_in
        new anchor.BN(1), // amount_out
      )
      .accountsStrict({
        payer: owner.publicKey,
        amm: poolKeys.id,
        ammProgram: globalInfo.ammProgram,
        ammAuthority: poolKeys.authority,
        ammOpenOrders: poolKeys.openOrders,
        ammCoinVault: poolKeys.baseVault,
        ammPcVault: poolKeys.quoteVault,
        marketProgram: globalInfo.marketProgram,
        market: globalInfo.market.publicKey,
        marketBids: market.bids,
        marketAsks: market.asks,
        marketEventQueue: market.eventQueue,
        marketCoinVault: market.baseVault,
        marketPcVault: market.quoteVault,
        marketVaultSigner: market.vaultOwner,
        userTokenSource: userCoinTokenAccount.address,
        userTokenDestination: userPcTokenAccount.address,
        userSourceOwner: owner.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction();

    let txResult = await buildOptimalTransaction({
      connection: conn,
      instructions: [ix],
      payer: owner.publicKey,
      lookupTables: [],
    });

    txResult.transaction.sign([owner]);
    let txsig = await conn.sendTransaction(txResult.transaction, confirmOptions);
    await conn.confirmTransaction(
      {
        blockhash: txResult.recentBlockhash.blockhash,
        lastValidBlockHeight: txResult.recentBlockhash.lastValidBlockHeight,
        signature: txsig,
      },
      "finalized",
    );

    console.log(`swap base out tx: ${txsig}`);
  });
});
