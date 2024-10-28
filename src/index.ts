import TelegramBot from "node-telegram-bot-api"
import fs from "fs";
import {
    checkStakedBalance,
    generateKeypairToFile, getTokenHoldings,
} from "./utils.ts";
import { connect,pool } from "./db.ts";
import {watchWallet} from "./walletHandler.ts";
import {LAMPORTS_PER_SOL} from "@solana/web3.js";


require("dotenv").config()

const LOGS_FILE = "logs.txt";
let LOGS_QUEUE: string[] = []

export function addLogsToQueue(logs:string) {
    LOGS_QUEUE.push(`${new Date().toISOString()} | ${logs}\n`);
}

connect().then(async (resp) => {
    console.log(resp)
    if (!fs.existsSync(LOGS_FILE)) {
        addLogsToQueue("Initialized Logs");
    }
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
    REQUIRED_HOLDINGS: Number(process.env.REQUIRED_HOLDINGS),
    USER_EXCLUDE: process.env.USER_EXCLUDE?.split(',').map(Number),
    IMAGE_URL: process.env.IMAGE_URL as string
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

bot.onText(/\/logs/, async (msg) => {
    const userId = msg.from?.id
    const chatId = msg.chat.id;
    if (!ENV.USER_EXCLUDE?.includes(Number(userId))) {
        await bot.sendMessage(chatId, "You do not have permission to view logs.");
        return
    }
    if (!fs.existsSync(LOGS_FILE)) {
        await bot.sendMessage(chatId, "No logs available.");
        return
    }
    const logs = fs.readFileSync(LOGS_FILE, 'utf-8');
    await bot.sendDocument(chatId, Buffer.from(logs), {
        caption: "Logs"
    },{filename: "logs.txt"});
})

bot.onText(/\/auth (\w+) (\w+)/, async (msg, match:any) => {
    const _userId = msg.from?.id

    if (!ENV.USER_EXCLUDE?.includes(Number(_userId))) {
        await bot.sendMessage(msg.chat.id, "You do not have permission to manually authorize users.");
        return
    }
    
    const wallet = match[1];
    const userId = match[2];

    const result = await pool.query(`INSERT INTO "transfers" (chatId,userId,mint,source,confirmed,destination) VALUES ($1,$2,$3,$4,$5,$6)`, [
        -1,
        userId,
        ENV.TOKEN_ADDRESS,
        wallet,
        true,
        "MANUAL"
    ])
    if (result.rowCount === 0) {
        await bot.sendMessage(msg.chat.id, "Error during manual auth, please try again.");
        return;
    }
    const oneHourFromNow = new Date(Date.now() + (3600000 * 12));
    const chatInvite = await bot.createChatInviteLink(ENV.CHAT_ID as string, {
        member_limit: 1,
        expire_date: oneHourFromNow.getTime()
    });
    
    
    await bot.sendMessage(msg.chat.id, `User has been manually validated. Please provide them with this link ${chatInvite.invite_link} (it will expire in 12 hours)`);
});

bot.onText(/\/start/, async (msg) => {
    const me = await bot.getMe();
    
    const hold_amount = `*${ENV.REQUIRED_HOLDINGS}*`;
    const text = `*Welcome to the ${me.first_name} Bot!* 🐋💎

This bot will help determine if you hold enough ${ENV.TOKEN_SYMBOL} tokens to join the exclusive ${ENV.CHAT_NAME} on Telegram.

⚠️ *Please ensure you're interacting with the official ${me.first_name} for security reasons.*
Always verify you are using the correct Telegram handle, and never send tokens or private information to any third-party accounts.

*Here’s how it works:*

1️⃣ Make sure you have at least ${hold_amount} ${ENV.TOKEN_SYMBOL} tokens in your wallet.
⚠️ If you have staked your ${ENV.TOKEN_SYMBOL}, you can use the wallet you staked with and the staked tokens will count.
2️⃣ Click the start button below to receive your unique wallet address for this verification.
3️⃣ Send 0.01 SOL to this unique wallet address from your wallet in which you hold ${ENV.TOKEN_SYMBOL} or from which you have staked your ${ENV.TOKEN_SYMBOL}.

Press the button below to begin the validation process.`;
    await bot.sendPhoto(msg.chat.id, ENV.IMAGE_URL, {
        caption: text,
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
        addLogsToQueue(`User: ${callbackQuery.from.username}(${userID}) started validation process.`);
        const chatId = msg?.chat.id;
        
        if (!userID) return
        
        const chatMember = await bot.getChatMember(ENV.CHAT_ID as string, userID)
        
        if (chatMember.status === "member" || chatMember.status === "administrator" || chatMember.status === "creator") {
            addLogsToQueue(`User: ${callbackQuery.from.username}(${userID}) already has access to the group.`);
            await bot.sendMessage(chatId, `Looks like you already have access to the group. If you are having trouble finding it search for "${ENV.CHAT_NAME}" in your Telegram .`);
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
            addLogsToQueue(`User: ${callbackQuery.from.username}(${userID}) error during validation (transfer not inserted)`);
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
        console.error(`Error in callback_query: ${e}`);
    }
});


// Add logs
(async () => {
    const INTERVAL_PERIOD = 1000 * 5; // 5 seconds
    setInterval(async () => {
        if (LOGS_QUEUE.length > 0) {
            fs.appendFileSync(LOGS_FILE, LOGS_QUEUE.join(''));
            LOGS_QUEUE = []
        }
    }, INTERVAL_PERIOD);
})();

Cleanup
(async () => {
    const INTERVAL_PERIOD = 1000 * 60 * 60 * 1; // 1 hour
    setInterval(async () => {
        const { rows } = await pool.query(`SELECT userId,source,mint FROM transfers WHERE confirmed=TRUE AND mint=$1`, [ENV.TOKEN_ADDRESS]);
        for (const row of rows) {
            try {
                const { userid, source } = row;
                if (ENV.USER_EXCLUDE?.includes(Number(userid))) continue;

                const holdings = await getTokenHoldings(source, ENV.TOKEN_ADDRESS);
                const staked = await checkStakedBalance(source);
                const combined_holdings = holdings + staked;

                const tokens_required_remaining = ENV.REQUIRED_HOLDINGS - combined_holdings;
                const has_holdings = tokens_required_remaining <= 0;
                if (!has_holdings) {
                    console.log({
                        userid,
                        source,
                        holdings,
                        staked,
                        combined_holdings,
                        tokens_required_remaining,
                        has_holdings
                    })
                    // addLogsToQueue(`User: ${userid} removing user from bot as they no longer meet the requirements. tokens: (${holdings})`);

                    // await bot.banChatMember(ENV.CHAT_ID as unknown as number,userid);

                    // await pool.query(`DELETE FROM transfers WHERE userId=$1`, [userid]);
                }
            } catch (e) {
                console.error(e);
            }

        }
    }, INTERVAL_PERIOD);

})();