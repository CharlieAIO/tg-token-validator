import fs from "node:fs";
import {
    type AccountInfo,
    Connection,
    Keypair,
    type ParsedAccountData,
    PublicKey,
    type RpcResponseAndContext,
    Transaction
} from "@solana/web3.js";
import {
    AccountLayout,
    createTransferInstruction,
    getAssociatedTokenAddress,
    getMint,
} from "@solana/spl-token";


export const connection = new Connection(process.env.SOL_HTTPS as string);

export function loadKeypairFromFile(wallet:string): [Keypair,string] {
    const keypairFile = JSON.parse(fs.readFileSync(`wallets/${wallet}.json`).toString());
    const secret = keypairFile.secretKey;
    const secretKey = Uint8Array.from(secret);
    return [Keypair.fromSecretKey(secretKey), keypairFile.tokenAccount];
}

export async function generateKeypairToFile(token:string): Promise<{
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
    fs.writeFileSync(`wallets/${token}.json`, JSON.stringify({
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

export async function sendBackBalance(transfer_info: any,returnAmount:number):Promise<string|null> {
    try {

        const {source, mint} = transfer_info;

        const [senderKeypair] = loadKeypairFromFile(mint);
        const recipientPublicKey = new PublicKey(source);
        const tokenMintPublicKey = new PublicKey(mint);

        const senderTokenAddress = await getAssociatedTokenAddress(tokenMintPublicKey, senderKeypair.publicKey);
        const recipientTokenAddress = await getAssociatedTokenAddress(tokenMintPublicKey, recipientPublicKey);

        const transferInstruction = createTransferInstruction(
            senderTokenAddress,
            recipientTokenAddress,
            senderKeypair.publicKey,
            returnAmount
        );
        

        const transaction = new Transaction().add(transferInstruction);

        const { blockhash } = await connection.getRecentBlockhash("recent");
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = senderKeypair.publicKey;

        const signature = await connection.sendTransaction(transaction, [senderKeypair]);
        await connection.confirmTransaction(signature);

        return signature
    } catch (e) {
        console.error("Error sending tokens back:", e);
        return null
    }
}
