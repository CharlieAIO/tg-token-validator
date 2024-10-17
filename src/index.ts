import TelegramBot from "node-telegram-bot-api"
import {
    generateKeypairToFile,
    getTokenHoldings, loadKeypairFromFile,
    lookupDecimals,
    validateAddress
} from "./utils.ts";
import {checkAmountDoesntExists, connect, pool} from "./db.ts";
import {watchSignature} from "./walletHandler.ts";
import fs from "fs";

require("dotenv").config()

connect().then(async (resp) => {
    console.log(resp)
    await setup();
})

export const bot = new TelegramBot((process.env.TG_BOT_TOKEN as string), {polling:true});

// bot.onText(/\/ping/, async (msg) => {
//     console.log(msg.chat.id)
//     await bot.sendMessage(msg.chat.id, "Pong!")
// })

let validatorInfo = {
    wallet: "",
    tokenAccount: "",
    token: "",
    symbol: "",
    decimals: 0,
    chatId: 0,
    supply:0,
    requiredHoldingsPercentage:0
}
const validationStatus = new Map();

async function setup() {
    const {TOKEN_ADDRESS,TOKEN_SYMBOL,CHAT_ID,TOTAL_SUPPLY,REQUIRED_HOLDINGS_PERCENT} = process.env;
    
    validatorInfo.token = TOKEN_ADDRESS as string;
    validatorInfo.symbol = TOKEN_SYMBOL as string;
    validatorInfo.chatId = Number(CHAT_ID);
    validatorInfo.supply = Number(TOTAL_SUPPLY)
    validatorInfo.requiredHoldingsPercentage = Number(REQUIRED_HOLDINGS_PERCENT);
    
    
    const wallets = fs.readdirSync('wallets');
    if (wallets.length === 0) {
        const walletData = await generateKeypairToFile(TOKEN_ADDRESS as string);
        validatorInfo.wallet = walletData.wallet;
        validatorInfo.tokenAccount = walletData.tokenAccount;
    }else {
        const foundWallet = wallets.find((wallet) => wallet.includes(TOKEN_ADDRESS as string));
        if (!foundWallet) {
            const walletData = await generateKeypairToFile(TOKEN_ADDRESS as string);
            validatorInfo.wallet = walletData.wallet;
            validatorInfo.tokenAccount = walletData.tokenAccount;
        } else {
            const [loadedKeyPair, tokenAccount] = loadKeypairFromFile(foundWallet.split(".")[0]);
            validatorInfo.wallet = loadedKeyPair.publicKey.toBase58();
            validatorInfo.tokenAccount = tokenAccount;
        }
        
    }
    const tokenDecimals = await lookupDecimals(TOKEN_ADDRESS as string);
    if (tokenDecimals) {
        validatorInfo.decimals = tokenDecimals;
    }

    // (async () => {
    //     watchSourceWallet(validatorInfo.wallet);
    // })()
    
}

bot.onText(/\/start/, async (msg) => {
    const required_amount = ((validatorInfo.supply * validatorInfo.requiredHoldingsPercentage) / 100).toFixed(2)
    const hold_amount = `*${required_amount}*`;
    const text = `*Welcome to the Ponke Whale Validator Bot!* 🐋💎

This bot will help determine if you hold enough PONKE tokens to join the exclusive Ponke Whale Club on Telegram.

⚠️ *Please ensure you're interacting with the official Ponke Whale Validator Bot for security reasons.*
Always verify you are using the correct Telegram handle, and never send tokens or private information to any third-party accounts.

*Here’s how it works:*
1️⃣ The bot will randomly select an amount between 1-20 PONKE tokens.
2️⃣ Send this exact amount from your whale wallet to the validator wallet.
3️⃣ After sending, provide the transaction signature or a Solscan link as verification.
4️⃣ Once confirmed, your tokens will be refunded.
5️⃣ If your wallet holds ${hold_amount} or more PONKE tokens, you’ll be officially recognized as a Ponke Whale and granted access to our exclusive whale group!

Ready to prove your whale status? 🌊✨

Type /validate {yourWalletAddress} to get started!`
    await bot.sendMessage(msg.chat.id, text, {parse_mode: "Markdown"});
})

bot.onText(/\/validate (\S+)/, async (msg, match:any) => {
    try {
        const chatId = msg.chat.id;
        const wallet = match[1];

        if (validationStatus.has(chatId)) {
            await bot.sendMessage(chatId, "You are already in the middle of a validation process. Please complete it before starting a new one.");
            return;
        }
        validationStatus.set(chatId, true);


        if (!validateAddress(wallet) || wallet == validatorInfo.wallet) {
            validationStatus.delete(chatId);
            await bot.sendMessage(chatId, "Invalid wallet address");
            return
        }


        const holdings = await getTokenHoldings(wallet, validatorInfo.token);

        if (holdings < (validatorInfo.supply * validatorInfo.requiredHoldingsPercentage) / 100) {
            validationStatus.delete(chatId);
            await bot.sendMessage(chatId, `Your wallet holds ${holdings} *${validatorInfo.symbol}*. You need to hold at least ${((validatorInfo.supply * validatorInfo.requiredHoldingsPercentage) / 100).toFixed(2)} *${validatorInfo.symbol}* to access the chat.`, {
                parse_mode: "Markdown"
            });
            return
        }

        // let randomPercentage = (Math.random() * 0.1) + 0.05; 
        // let sendAmount = ((holdings * randomPercentage) / 100).toFixed(2);
        let sendAmount = ((Math.random() * 19) + 1).toFixed(2);
        while (!await checkAmountDoesntExists(validatorInfo.token, Number(sendAmount))) {
            sendAmount = ((Math.random() * 19) + 1).toFixed(2)
        }

        let message = `Your wallet holds ${holdings.toFixed(2)}\n\n` +
            `Please send ${sendAmount} *${validatorInfo.symbol}* to *${validatorInfo.wallet}*\n\n` +
            `After sending the tokens, please paste the Solscan transaction link underneath this message.`;


        const result = await pool.query(`INSERT INTO "transfers" (validatorId,chatId,mint,source,destination,amount) VALUES ($1,$2,$3,$4,$5,$6)`, [
            -1,
            chatId,
            validatorInfo.token,
            wallet,
            validatorInfo.wallet,
            sendAmount
        ])
        if (result.rowCount === 0) {
            await bot.sendMessage(chatId, "Error during validation, please try again.");
            validationStatus.delete(chatId);
            return;
        }


        await bot.sendMessage(chatId, message, {
            parse_mode: "Markdown",
            disable_web_page_preview: true
        });

        const askForSignature = async (chatId: number, userId: number) => {
            const signatureRegex = /^[A-Za-z0-9]{86,88}$/;
            const urlRegex = /\/tx\/([A-Za-z0-9]{86,88})/;
            
            bot.once('message', async (response:any) => {
                if (response.chat.id !== chatId || response?.from?.id !== userId) {
                    // Wait for the correct user to reply
                    askForSignature(chatId, userId);
                    return;
                }
                
                let signature = response.text;
                if (!signature) {
                    // await bot.sendMessage(response.chat.id, "No signature provided. Please send the correct transaction signature.");
                    askForSignature(chatId, userId);
                    return;
                }

                const urlMatch = signature.match(urlRegex);
                if (urlMatch) {
                    signature = urlMatch[1];
                }

                if (!signature || !signatureRegex.test(signature)) {
                    // await bot.sendMessage(response.chat.id, "Invalid signature format. Please send the correct transaction signature.");
                    askForSignature(chatId, userId);
                    return;
                }

                const oneHourFromNow = new Date(Date.now() + 3600000);
                const chatInvite = await bot.createChatInviteLink(validatorInfo.chatId, {
                    member_limit: 1,
                    expire_date: oneHourFromNow.getTime()
                });
                await watchSignature(signature as string, chatId, chatInvite.invite_link);
                validationStatus.delete(chatId);
                return
            });
        };
        
        if (!msg?.from?.id) {
            await bot.sendMessage(chatId, "Error. Please try again.");
            return
        }
        askForSignature(chatId, msg.from.id);
    } catch {
        await bot.sendMessage(msg.chat.id, "Error validating wallet")
    }
});

