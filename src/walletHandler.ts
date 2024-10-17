import {TOKEN_PROGRAM_ID} from "@solana/spl-token";
import {connection, getTokenAccountOwner, sendBackBalance} from "./utils.ts";
import {confirmTransfer} from "./db.ts";
import {bot} from "./index.ts";

const success_message = (invite:string) => `*Access to the Whale Club has been granted!*\nYou can join the channel [*here*](${invite}) (INVITE WILL EXPIRE IN 1 HOUR)`;
const failed_message = (amount:number) => `Sorry you still need ${amount} tokens to access the Degenerate Whale chat. Your tokens will be sent back;`;

export async function watchSignature(signature: string, chatId: number,invite_link: string) {
    const status = await  connection.getSignatureStatus(signature, {searchTransactionHistory: true});
    if (status.value == null) {
        await bot.sendMessage(chatId, "Invalid transaction, doesnt contain a token transfer. Please start over...", {parse_mode:"Markdown"})
        return 
    }
    if (!["confirmed","finalized"].includes(status.value?.confirmationStatus || "none")) {
        await new Promise<void>((resolve, reject) => {
            connection.onSignature(signature, (result) => {
                if (result.err) {
                    reject(result.err);
                } else {
                    resolve();
                }
            }, "confirmed");
        });
    }

    let txDetails = await connection.getParsedTransaction(signature,{maxSupportedTransactionVersion:0});
    let attempts = 6;
    if (!txDetails) {
        while (!txDetails && attempts > 0) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            txDetails = await connection.getParsedTransaction(signature, {maxSupportedTransactionVersion:undefined});
            attempts--;
        }
    }
    
    if (!txDetails) {
        await bot.sendMessage(chatId, "Error fetching transaction details, please try again later.")
        return
    }

    try {
        const blockTime = txDetails
        for (const instruction of txDetails.transaction.message.instructions) {
            if (instruction.programId.toString() === TOKEN_PROGRAM_ID.toString()) {
                if (!instruction.parsed.info.source || !instruction.parsed.info.destination || !instruction.parsed.info.tokenAmount || !instruction.parsed.info.mint) {
                    continue
                }
                // @ts-ignore
                const source = await getTokenAccountOwner(instruction.parsed.info.source);
                // @ts-ignore
                const destination = await getTokenAccountOwner(instruction.parsed.info.destination);

                const transfer_info = {
                    signature,
                    source,
                    destination,
                    amount:instruction.parsed.info.tokenAmount.uiAmount,
                    mint:instruction.parsed.info.mint,
                    blockTime,
                    chatId
                };
                const [confirmed,returnFunds] = await confirmTransfer(transfer_info)
                if (!confirmed) {
                    await bot.sendMessage(chatId, returnFunds?failed_message(transfer_info.amount):"Access Denied.")
                } else {
                    await bot.sendMessage(chatId, success_message(invite_link), {parse_mode:"Markdown"})
                    
                }
                if (returnFunds) {
                    // @ts-ignore
                    const returnSig = await sendBackBalance(transfer_info,Number(instruction.parsed.info.tokenAmount.amount))
                    if (returnSig) {
                        await bot.sendMessage(chatId, `*Your refund has been issued!*\nhttps://solscan.io/tx/${returnSig}`,{parse_mode:"Markdown"})
                    } else {
                        await bot.sendMessage(chatId, "Error sending tokens back, please try again.")
                    }
                }
                return 


            }
        }

        await bot.sendMessage(chatId, "Invalid transaction, doesnt contain a token transfer. Please start over...", {parse_mode:"Markdown"})
        return 
    }catch (e) {
        console.error("Error parsing transaction:", e);
        return null
    }

}