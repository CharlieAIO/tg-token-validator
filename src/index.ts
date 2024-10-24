import TelegramBot from "node-telegram-bot-api"
import {
    generateKeypairToFile, getTokenHoldings,
} from "./utils.ts";
import { connect,pool } from "./db.ts";
import {watchWallet} from "./walletHandler.ts";
import {LAMPORTS_PER_SOL} from "@solana/web3.js";


require("dotenv").config()

connect().then(async (resp) => {
    console.log(resp)
})

export const bot = new TelegramBot((process.env.TG_BOT_TOKEN as string), {polling:true});

// Use this to retrieve the chat id of a group.
// bot.onText(/\/ping/, async (msg) => {
//     console.log(msg.chat.id)
//     await bot.sendMessage(msg.chat.id, "Pong!")
// })

const ENV = {
    CHAT_NAME: process.env.CHAT_NAME as string,
    TOKEN_ADDRESS: process.env.TOKEN_ADDRESS as string,
    TOKEN_SYMBOL: process.env.TOKEN_SYMBOL as string,
    CHAT_ID: process.env.CHAT_ID,
    TOTAL_SUPPLY: Number(process.env.TOTAL_SUPPLY),
    REQUIRED_HOLDINGS_PERCENT: Number(process.env.REQUIRED_HOLDINGS_PERCENT),
    USER_EXCLUDE: process.env.USER_EXCLUDE?.split(',').map(Number),
}
type EnvKey = keyof typeof ENV;
(Object.keys(ENV) as EnvKey[]).forEach(key => {
    const value = ENV[key];
    if (value === undefined || value === '') {
        throw new Error(`Missing environment variable: ${key}`);
    }
    if (typeof value === 'number' && isNaN(value)) {
        throw new Error(`Invalid numeric value for environment variable: ${key}`);
    }
});

const validationStatus = new Map();

bot.onText(/\/start/, async (msg) => {
    const me = await bot.getMe();
    
    const required_amount = ((ENV.TOTAL_SUPPLY * ENV.REQUIRED_HOLDINGS_PERCENT) / 100).toFixed(2)
    const hold_amount = `*${required_amount}*`;
    const text = `*Welcome to the ${me.first_name} Bot!* 🐋💎

This bot will help determine if you hold enough ${ENV.TOKEN_SYMBOL} tokens to join the exclusive ${ENV.CHAT_NAME} on Telegram.

⚠️ *Please ensure you're interacting with the official ${me.first_name} for security reasons.*
Always verify you are using the correct Telegram handle, and never send tokens or private information to any third-party accounts.

*Here’s how it works:*

1️⃣ Make sure you have at least ${hold_amount} ${ENV.TOKEN_SYMBOL} tokens in your whale wallet.
⚠️ If you have staked your ${ENV.TOKEN_SYMBOL}, you can use the wallet you staked with and the staked tokens will count. ⚠️
2️⃣ Click the start button below to recieve your unique wallet address for this verification.
3️⃣ Send 0.01 SOL to this unique wallet address from your whale wallet.

Ready to prove your whale status? 🌊✨

Press the button below to begin the validation process.`;
    await bot.sendMessage(msg.chat.id, text, {
        parse_mode: "Markdown",
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: "Begin Validation",
                        callback_data: "start_validation"
                    }
                ]
            ]
        },
    });
})


bot.on('callback_query', async (callbackQuery) => {
    const action = callbackQuery.data;
    const userID = callbackQuery.from.id;
    const msg = callbackQuery.message;
    try {
        if (!msg) return;
        if (action !== 'start_validation') return
        const chatId = msg?.chat.id;
        
        if (!userID) return
        
        const chatMember = await bot.getChatMember(ENV.CHAT_ID as string, userID)
        
        if (chatMember.status === "member" || chatMember.status === "administrator" || chatMember.status === "creator") {
            await bot.sendMessage(chatId, "You are already have access. Ending validation process.");
            return;
        }

        if (validationStatus.has(chatId)) {
            await bot.sendMessage(chatId, "You are already in the middle of a validation process. Please complete it before starting a new one.");
            return;
        }
        validationStatus.set(chatId, true);


        // let sendAmount = Math.random() * 0.19 + 0.01;
        let sendAmount = 0.01;
        sendAmount = Math.round(sendAmount * 100) / 100;

        const lamports = Math.floor(sendAmount * LAMPORTS_PER_SOL);
        const walletData = await generateKeypairToFile(ENV.TOKEN_ADDRESS, chatId);

        let message = `Please send ${sendAmount.toFixed(2)} *SOL* to \`${walletData.wallet}\` (This will be refunded.)`;
        
        const result = await pool.query(`INSERT INTO "transfers" (chatId,userId,mint,destination,amount) VALUES ($1,$2,$3,$4,$5)`, [
            chatId,
            userID,
            ENV.TOKEN_ADDRESS,
            walletData.wallet,
            lamports
        ])
        if (result.rowCount === 0) {
            await bot.sendMessage(chatId, "Error during validation, please try again.");
            validationStatus.delete(chatId);
            return;
        }


        await bot.sendMessage(chatId, message, {
            parse_mode: "Markdown",
            disable_web_page_preview: true,
        });
        await watchWallet(walletData.wallet, ENV, chatId, userID);
        validationStatus.delete(chatId);
        
    } catch(e) {
        validationStatus.delete(msg?.chat?.id);
        console.error(e);
    }
});



// Cleanup
(async () => {
    const INTERVAL_PERIOD = 1000 * 60 * 60 * 1; // 1 hour
    setInterval(async () => {
        const { rows } = await pool.query(`SELECT userId,source,mint FROM transfers WHERE confirmed=TRUE AND mint=$1`, [ENV.TOKEN_ADDRESS]);
        for (const row of rows) {
            try {
                const { userid, source } = row;
                if (ENV.USER_EXCLUDE?.includes(Number(userid))) continue;

                const holdings = await getTokenHoldings(source, ENV.TOKEN_ADDRESS);
                const tokens_required_remaining = (ENV.TOTAL_SUPPLY * ENV.REQUIRED_HOLDINGS_PERCENT) / 100 - holdings;
                const has_holdings = tokens_required_remaining <= 0;
                if (!has_holdings) {
                    await bot.banChatMember(ENV.CHAT_ID as unknown as number,userid);
                    
                    await pool.query(`DELETE FROM transfers WHERE userId=$1`, [userid]);
                }
            } catch (e) {
                console.error(e);
            }
        
        }
    }, INTERVAL_PERIOD);
    
})();