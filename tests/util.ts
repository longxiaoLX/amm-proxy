import {
    Keypair,
    Connection,
    PublicKey,
    Transaction,
    SystemProgram,
    TransactionSignature,
    TransactionInstruction,
    AddressLookupTableAccount,
    ComputeBudgetProgram,
    VersionedTransaction,
    TransactionMessage
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    createMint,
    getOrCreateAssociatedTokenAccount,
    mintTo
} from "@solana/spl-token";
import {
    TokenInstructions,
    Market as MarketSerum,
    DexInstructions
} from "@project-serum/serum";
import {
    SPL_MINT_LAYOUT,
    Market as raydiumSerum
} from "@raydium-io/raydium-sdk";
import * as anchor from "@coral-xyz/anchor";
import { getSimulationComputeUnits } from "@solana-developers/helpers";

export class Market extends MarketSerum {
    public baseVault: PublicKey | null = null;
    public quoteVault: PublicKey | null = null;
    public requestQueue: PublicKey | null = null;
    public eventQueue: PublicKey | null = null;
    public bids: PublicKey | null = null;
    public asks: PublicKey | null = null;
    public baseLotSize: number = 0;
    public quoteLotSize: number = 0;
    // private _decoded: any
    public quoteMint: PublicKey | null = null;
    public baseMint: PublicKey | null = null;
    public vaultSignerNonce: anchor.BN | null = null;
    public vaultOwner: PublicKey | null = null;

    static async load(
        connection: Connection,
        address: PublicKey,
        options: any = {},
        programId: PublicKey
    ) {
        const { owner, data } = throwIfNull(
            await connection.getAccountInfo(address),
            "Market not found"
        );
        if (!owner.equals(programId)) {
            throw new Error("Address not owned by program: " + owner.toBase58());
        }
        const decoded = this.getLayout(programId).decode(data);
        if (
            !decoded.accountFlags.initialized ||
            !decoded.accountFlags.market ||
            !decoded.ownAddress.equals(address)
        ) {
            throw new Error("Invalid market");
        }
        const [baseMintDecimals, quoteMintDecimals] = await Promise.all([
            getMintDecimals(connection, decoded.baseMint),
            getMintDecimals(connection, decoded.quoteMint),
        ]);

        const market = new Market(
            decoded,
            baseMintDecimals,
            quoteMintDecimals,
            options,
            programId
        );
        // market._decoded = decoded
        market.baseLotSize = decoded.baseLotSize;
        market.quoteLotSize = decoded.quoteLotSize;
        market.baseVault = decoded.baseVault;
        market.quoteVault = decoded.quoteVault;
        market.requestQueue = decoded.requestQueue;
        market.eventQueue = decoded.eventQueue;
        market.bids = decoded.bids;
        market.asks = decoded.asks;
        market.quoteMint = decoded.quoteMint;
        market.baseMint = decoded.baseMint;
        market.vaultSignerNonce = decoded.vaultSignerNonce;

        const vaultOwner = PublicKey.createProgramAddressSync(
            [address.toBuffer(), market.vaultSignerNonce.toArrayLike(Buffer, "le", 8)],
            programId,
        );
        market.vaultOwner = vaultOwner;

        return market;
    }
}

function throwIfNull<T>(value: T | null, message = "account not found"): T {
    if (value === null) {
        throw new Error(message);
    }
    return value;
}

// 获取 mint account 的 decimals
export async function getMintDecimals(
    connection: Connection,
    mint: PublicKey
): Promise<number> {
    const { data } = throwIfNull(
        await connection.getAccountInfo(mint),
        "mint not found"
    );
    const { decimals } = SPL_MINT_LAYOUT.decode(data);
    return decimals;
}

export async function createMintPair(
    connection: Connection,
    payer: Keypair
): Promise<{ tokenA: PublicKey, tokenB: PublicKey }> {
    const tokenA = await createMint(
        connection,
        payer,
        payer.publicKey,
        null,
        9
    );
    const tokenB = await createMint(
        connection,
        payer,
        payer.publicKey,
        null,
        9,
    );

    const payerTokenAAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        tokenA,
        payer.publicKey,
        false,
        "processed",
        undefined,
        TOKEN_PROGRAM_ID,
    );
    await mintTo(
        connection,
        payer,
        tokenA,
        payerTokenAAccount.address,
        payer.publicKey,
        100_000_000_000_000,
        [],
        { skipPreflight: true },
        TOKEN_PROGRAM_ID,
    );

    const payerTokenBAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        tokenB,
        payer.publicKey,
        false,
        "processed",
        undefined,
        TOKEN_PROGRAM_ID,
    );
    await mintTo(
        connection,
        payer,
        tokenB,
        payerTokenBAccount.address,
        payer.publicKey,
        100_000_000_000_000,
        [],
        { skipPreflight: true },
        TOKEN_PROGRAM_ID,
    );
    console.log(
        "create tokenA: ",
        tokenA.toString(),
        " token B: ",
        tokenB.toString(),
    );
    return { tokenA, tokenB }
}

export async function createMarket({
    connection,
    payer,
    baseMint,
    quoteMint,
    baseLotSize,
    quoteLotSize,
    dexProgram,
    market
}: {
    connection: Connection,
    payer: Keypair,
    baseMint: PublicKey,
    quoteMint: PublicKey,
    baseLotSize: number,
    quoteLotSize: number,
    dexProgram: PublicKey,
    market: Keypair,
}) {
    const requestQueue = new Keypair();
    const eventQueue = new Keypair();
    const bids = new Keypair(); // 买单
    const asks = new Keypair(); // 卖单
    const baseVault = new Keypair();
    const quoteVault = new Keypair();
    const feeRateBps = 0;
    const quoteDustThreshold = new anchor.BN(10);
    // 不清楚为什么这样不可以
    // const [vaultOwner, vaultNonce] = PublicKey.findProgramAddressSync(
    //     [market.publicKey.toBuffer()],
    //     dexProgram
    // );
    const { vaultOwner, vaultNonce } = await getVaultOwnerAndNonce(
        market.publicKey,
        dexProgram
    );

    const tx1 = new Transaction();
    tx1.add(
        // 创建存储在 market 的 base 代币
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: baseVault.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(165),
            space: 165,
            programId: TOKEN_PROGRAM_ID,
        }),
        // 创建存储在 market 的 quote 代币
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: quoteVault.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(165),
            space: 165,
            programId: TOKEN_PROGRAM_ID,
        }),
        // 初始化 baseVault 这个代币账户，其 owner 是 vaultOwner，即 dexProgram 对其有转移代币等功能权限
        TokenInstructions.initializeAccount({
            account: baseVault.publicKey,
            mint: baseMint,
            owner: vaultOwner,
        }),
        TokenInstructions.initializeAccount({
            account: quoteVault.publicKey,
            mint: quoteMint,
            owner: vaultOwner,
        }),
    );

    const tx2 = new Transaction();
    tx2.add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: market.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(
                Market.getLayout(dexProgram).span
            ),
            space: Market.getLayout(dexProgram).span,
            programId: dexProgram,
        }),
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: requestQueue.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(5120 + 12),
            space: 640 + 12,
            programId: dexProgram,
        }),
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: eventQueue.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(262144 + 12),
            space: 262144 + 12,
            programId: dexProgram,
        }),
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: bids.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(65536 + 12),
            space: 65536 + 12,
            programId: dexProgram,
        }),
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: asks.publicKey,
            lamports: await connection.getMinimumBalanceForRentExemption(65536 + 12),
            space: 65536 + 12,
            programId: dexProgram,
        }),
        DexInstructions.initializeMarket({
            market: market.publicKey,
            requestQueue: requestQueue.publicKey,
            eventQueue: eventQueue.publicKey,
            bids: bids.publicKey,
            asks: asks.publicKey,
            baseVault: baseVault.publicKey,
            quoteVault: quoteVault.publicKey,
            baseMint,
            quoteMint,
            baseLotSize: new anchor.BN(baseLotSize),
            quoteLotSize: new anchor.BN(quoteLotSize),
            feeRateBps,
            // vaultSignerNonce: new anchor.BN(vaultNonce),
            vaultSignerNonce: vaultNonce,
            quoteDustThreshold,
            programId: dexProgram,
            authority: undefined,
        })
    );

    const signedTransactions = await signTransactions(
        [
            { transaction: tx1, signers: [baseVault, quoteVault] },
            {
                transaction: tx2,
                signers: [market, requestQueue, eventQueue, bids, asks],
            },
        ],
        payer,
        connection,
    );
    for (let signedTransaction of signedTransactions) {
        await sendSignedTransaction({
            signedTransaction,
            connection: connection,
        });
    }

    return {
        market: market.publicKey,
        requestQueue: requestQueue.publicKey,
        eventQueue: eventQueue.publicKey,
        bids: bids.publicKey,
        asks: asks.publicKey,
        baseVault: baseVault.publicKey,
        quoteVault: quoteVault.publicKey,
        baseMint,
        quoteMint,
        baseLotSize: new anchor.BN(baseLotSize),
        quoteLotSize: new anchor.BN(quoteLotSize),
        feeRateBps,
        vaultOwner,
        vaultSignerNonce: vaultNonce,
        quoteDustThreshold,
        programId: dexProgram,
        // authority: undefined,
    };
}

export async function signTransactions(
    transactionsAndSigners: {
        transaction: Transaction;
        signers?: Array<Keypair>;
    }[],
    payer: Keypair,
    connection: Connection,
): Promise<Transaction[]> {
    const blockhash = (await connection.getLatestBlockhash()).blockhash;
    transactionsAndSigners.forEach(({ transaction, signers = [] }) => {
        transaction.recentBlockhash = blockhash;
        transaction.sign(payer);
        if (signers?.length > 0) {
            transaction.partialSign(...signers);
        }
    });
    return transactionsAndSigners.map(item => item.transaction)
}

export async function sendSignedTransaction({
    signedTransaction,
    connection,
    timeout = 10000,
}: {
    signedTransaction: Transaction;
    connection: Connection;
    timeout?: number;
}): Promise<string> {
    const rawTransaction = signedTransaction.serialize();
    const startTime = getUnixTs();

    const txid: TransactionSignature = await connection.sendRawTransaction(
        rawTransaction,
        {
            skipPreflight: true,
        }
    );

    console.log("txid:", txid);
    await sleep(timeout);
    console.log("Latency", txid, getUnixTs() - startTime);
    return txid;
}

export const getUnixTs = () => {
    return new Date().getTime() / 1000;
};

export async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getMarket(
    conn: Connection,
    marketAddress: PublicKey,
    serumProgramId: PublicKey,
): Promise<Market> {
    try {
        const market = await Market.load(
            conn,
            marketAddress,
            undefined,
            serumProgramId
        );
        return market;
    } catch (error) {
        console.log("get market err: ", error);
        throw error;
    }
}

export async function getVaultOwnerAndNonce(
    marketId: PublicKey,
    dexProgramId: PublicKey,
) {
    const vaultNonce = new anchor.BN(0);
    while (true) {
        try {
            // 这里在创建 pda，但是 nonce 却是从 0 开始的，不同于 bump 从 255 开始
            const vaultOwner = PublicKey.createProgramAddressSync(
                [marketId.toBuffer(), vaultNonce.toArrayLike(Buffer, "le", 8)],
                dexProgramId
            );
            console.log(`vault nonce is ${vaultNonce}`)
            return { vaultOwner, vaultNonce };
        } catch (error) {
            vaultNonce.iaddn(1);
        }
    }
}

export async function buildOptimalTransaction({
    connection,
    instructions,
    payer,
    lookupTables
}: {
    connection: Connection;
    instructions: Array<TransactionInstruction>;
    payer: PublicKey;
    lookupTables: Array<AddressLookupTableAccount>;
}) {
    const [microLamports, units, recentBlockhash] = await Promise.all([
        100,
        await getSimulationComputeUnits(
            connection,
            instructions,
            payer,
            lookupTables
        ) + 1000,
        await connection.getLatestBlockhash(),
    ]);

    instructions.unshift(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
    );
    if (units) {
        instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units }));
    }
    return {
        transaction: new VersionedTransaction(
            new TransactionMessage({
                instructions,
                recentBlockhash: recentBlockhash.blockhash,
                payerKey: payer,
            }).compileToV0Message(lookupTables),
        ),
        recentBlockhash,
    };
}