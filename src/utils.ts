import fs from "node:fs";
import {
    type AccountInfo,
    Connection,
    Keypair,
    type ParsedAccountData,
    PublicKey,
    sendAndConfirmTransaction,
    SystemProgram,
    Transaction
} from "@solana/web3.js";
import {AccountLayout, getAssociatedTokenAddress, getMint,} from "@solana/spl-token";


const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
export const connection = new Connection(process.env.SOL_HTTPS as string);

export function deleteKeypairFile(chatId:number): void {
    fs.rmSync(`wallets/${chatId}.json`);
}

export function loadKeypairFromFile(chatId:number): [Keypair,string] {
    const keypairFile = JSON.parse(fs.readFileSync(`wallets/${chatId}.json`).toString());
    const secret = keypairFile.secretKey;
    const secretKey = Uint8Array.from(secret);
    return [Keypair.fromSecretKey(secretKey), keypairFile.tokenAccount];
}

export async function generateKeypairToFile(token:string, chatId:number): Promise<{
    wallet: string,
    tokenAccount: string
}> {
    const keypair = Keypair.generate();
    let token_account;
    try {
        token_account = await getAssociatedTokenAddress(new PublicKey(token),keypair.publicKey,true);
    } catch {
        throw new Error("Invalid token address");
    }
    fs.writeFileSync(`wallets/${chatId}.json`, JSON.stringify({
        secretKey: Array.from(keypair.secretKey),
        publicKey: keypair.publicKey.toBase58(),
        tokenAccount: token_account.toBase58()
    }));
    return {
        wallet: keypair.publicKey.toBase58(),
        tokenAccount:token_account.toBase58()
    };
}

export function validateAddress(address: string): boolean {
    try {
        const publicKey = new PublicKey(address);
        return PublicKey.isOnCurve(publicKey.toBytes());
    } catch (e) {
        return false;
    }
}

async function getTokenAccount(walletAddress: string, tokenMintAddress: string): Promise<Array<{
    pubkey: PublicKey;
    account: AccountInfo<ParsedAccountData>
}> | null> {
    const walletPublicKey = new PublicKey(walletAddress);
    const tokenMintPublicKey = new PublicKey(tokenMintAddress);

    try {
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPublicKey, { mint: tokenMintPublicKey });
        return tokenAccounts.value;
    } catch (e) {
        console.error("Error fetching token accounts:", e);
        return null
    }
}

export async function getTokenAccountOwner(tokenAccountAddress: string): Promise<string|null> {
    const tokenAccountPublicKey = new PublicKey(tokenAccountAddress);

    try {
        const accountInfo = await connection.getAccountInfo(tokenAccountPublicKey);
        if (accountInfo === null) {
            return null
        }

        // @ts-ignore
        const parsedAccountInfo = AccountLayout.decode(accountInfo.data);
        const ownerPublicKey = new PublicKey(parsedAccountInfo.owner);

        return ownerPublicKey.toBase58();
    } catch (e) {
        return null;
    }
}

export async function getTokenHoldings(walletAddress:string, tokenMintAddress:string):Promise<number> {
    let tokenAccounts = await getTokenAccount(walletAddress, tokenMintAddress);
    if (!tokenAccounts) {
        return 0;
    }

    let totalBalance = 0;
    for (const account of tokenAccounts) {
        const balance = account.account.data.parsed.info.tokenAmount.uiAmount;
        totalBalance += balance;
    }

    return totalBalance;
}

export async function lookupDecimals(token: string): Promise<number|null> {
    try {
        const tokenMintPublicKey = new PublicKey(token);
        const mintInfo = await getMint(connection, tokenMintPublicKey);
        return mintInfo.decimals

    } catch (e) {
        console.error("Error fetching token accounts:", e);
        return null
    }
}

export async function sendBackBalance(transfer_info: any): Promise<string | null> {
    let retries = 0;

    while (retries < MAX_RETRIES) {
        try {
            const { source, chatId } = transfer_info;
            const [senderKeypair] = loadKeypairFromFile(chatId);
            const sourcePK = new PublicKey(source);

            const senderBalance = await connection.getBalance(senderKeypair.publicKey);

            const rentExemptionAmount = await connection.getMinimumBalanceForRentExemption(0);

            const { feeCalculator } = await connection.getRecentBlockhash();
            const estimatedFee = feeCalculator.lamportsPerSignature;

            const maxTransferAmount = senderBalance - rentExemptionAmount - estimatedFee;

            if (maxTransferAmount <= 0) {
                return null;
            }
            
            const transferInstruction = SystemProgram.transfer({
                fromPubkey: senderKeypair.publicKey,
                toPubkey: sourcePK,
                lamports: maxTransferAmount
            });

            const transaction = new Transaction().add(transferInstruction);

            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = senderKeypair.publicKey;

            return await sendAndConfirmTransaction(
                connection,
                transaction,
                [senderKeypair],
                {
                    maxRetries: 5,
                    skipPreflight: true
                }
            );
        } catch (e) {
            console.error(`Error sending tokens back (attempt ${retries + 1}):`, e);

            retries++;
            if (retries < MAX_RETRIES) {
                console.log(`Retrying in ${RETRY_DELAY / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            } else {
                console.error("Max retries reached. Transaction failed.");
                return null;
            }
        }
    }

    return null;
}