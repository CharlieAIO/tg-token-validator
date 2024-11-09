import {checkStakedBalance, connection, deleteKeypairFile, getTokenHoldings, sendBackBalance} from "./utils.ts";
import {confirmTransfer} from "./db.ts";
import {addLogsToQueue, bot} from "./index.ts";
import {PublicKey} from "@solana/web3.js";

const success_message = (invite:string) => `*Access to the Whale Club has been granted!*\nYou can join the channel [*here*](${invite}) (INVITE WILL EXPIRE IN 1 HOUR)`;
const failed_message = (amount:string,chatName:string) => `Sorry you need ${amount} tokens to access the ${chatName} chat. Your tokens will be sent back.`;

export async function watchWallet(wallet: string, ENV:any, chatId: number, userId:number) {
    let signatures = await connection.getSignaturesForAddress(new PublicKey(wallet));
    
    if (!signatures.length) {
        while(!signatures.length) { 
            await new Promise(resolve => setTimeout(resolve, 5000));
            signatures = await connection.getSignaturesForAddress(new PublicKey(wallet));
        }
    }
    const signature = signatures[0].signature

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
    
    await processTransaction(txDetails, signature, ENV, chatId, userId)

}

async function processTransaction(txDetails: any, signature:string, ENV:any, chatId: number, userId:number) {
    try {
        const blockTime = txDetails
        for (const instruction of txDetails.transaction.message.instructions) {
            if (instruction.program == "system") {
                if (!instruction.parsed.info.source || !instruction.parsed.info.destination || !instruction.parsed.info.lamports) {
                    continue
                }
                const transfer_info = {
                    signature,
                    source:instruction.parsed.info.source,
                    destination:instruction.parsed.info.destination,
                    amount:instruction.parsed.info.lamports,
                    blockTime,
                    chatId
                };

                const holdings = await getTokenHoldings(transfer_info.source, ENV.TOKEN_ADDRESS);
                const staked = await checkStakedBalance(transfer_info.source);
                
                const combined_holdings = holdings + staked;
                
                
                const tokens_required_remaining = ENV.REQUIRED_HOLDINGS - (combined_holdings);
                const has_holdings = tokens_required_remaining <= 0

                const [confirmed,returnFunds, isUniqueWallet] = await confirmTransfer(transfer_info)
                if (!confirmed || !has_holdings || !isUniqueWallet) {
                    if (!isUniqueWallet) {
                        addLogsToQueue(`User: ${userId} attempted to verify a wallet that has already been verified.`)
                        await bot.sendMessage(chatId, "This wallet has already been verified by another user. Please choose a different wallet.")
                    } else {
                        await bot.sendMessage(chatId, returnFunds?failed_message(tokens_required_remaining.toFixed(2), ENV.CHAT_NAME):"Access Denied.")
                    }
                    
                } else if (has_holdings){
                    const oneHourFromNow = Math.floor(Date.now() / 1000) + 3600;
                    try {
                        addLogsToQueue(`User: ${userId} granting access to chat`)
                        await bot.unbanChatMember(ENV.CHAT_ID, userId, {only_if_banned:true})
                        const chatInvite = await bot.createChatInviteLink(ENV.CHAT_ID, {
                            member_limit: 1,
                            expire_date: oneHourFromNow.getTime()
                        });
                        await bot.sendMessage(chatId, success_message(chatInvite.invite_link), {parse_mode:"Markdown"})
                    } catch (e){
                        addLogsToQueue(`User: ${userId} error creating chat invite link ${e.toString()}`)

                        await bot.sendMessage(chatId, "Error creating chat invite link, please contact an admin for assistance.")
                    }

                }
                
                
                if (returnFunds) {
                    const returnSig = await sendBackBalance(transfer_info)
                    if (returnSig) {
                        await bot.sendMessage(chatId, `*Your refund has been issued!*\nhttps://solscan.io/tx/${returnSig}`,{parse_mode:"Markdown"})
                        deleteKeypairFile(chatId)
                    } else {
                        addLogsToQueue(`User: ${userId} error sending back tokens`)

                        await bot.sendMessage(chatId, "Error sending tokens back, please try again.")
                    }
                }
                return


            }
        }

        addLogsToQueue(`User: ${userId} invalid transaction, doesnt contain a token transfer.`)
        await bot.sendMessage(chatId, "Invalid transaction, doesnt contain a token transfer. Please start over...", {parse_mode:"Markdown"})
        return
    }catch (e) {
        addLogsToQueue(`User: ${userId} error processing transaction: ${e}`)

        console.error("Error parsing transaction:", e);
        return null
    }
}
