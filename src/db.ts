import {Pool} from "pg"
import {checkStakedBalance, getTokenHoldings} from "./utils.ts";

export const pool = new Pool({
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    port: parseInt(process.env.PG_PORT as string),
    connectionTimeoutMillis: 5000,
});

function delay(ms:number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


export async function connect(retries = 5, delayMs = 2000) {
    try {
        await pool.connect();
        await createTransfersTable()
        await createValidatorsTable()
        return 'Connected to the database'
    } catch (err) {
        console.error('Error connecting to the database', err);
        if (retries > 0) {
            console.log(`Retrying in ${delayMs / 1000} seconds... (${retries} attempts left)`);
            await delay(delayMs);
            return connect(retries - 1, delayMs);
        } else {
            throw new Error('Failed to connect to the database after multiple attempts.');
        }
    }
}


async function createTransfersTable() {
    await pool.query(`CREATE TABLE IF NOT EXISTS "transfers" (
        signature BYTEA DEFAULT NULL,
        chatId NUMERIC DEFAULT NULL,
        userId NUMERIC DEFAULT NULL,
        mint VARCHAR(44),
        source VARCHAR(44),
        destination VARCHAR(44),
        amount BIGINT,
        confirmed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (destination, mint, amount)
    );`)
}

async function createValidatorsTable() {
    await pool.query(`CREATE TABLE IF NOT EXISTS "validators" (
        id SERIAL PRIMARY KEY,
        token VARCHAR(44),
        symbol VARCHAR(20),
        decimals INT,
        wallet VARCHAR(44),
        tokenAccount VARCHAR(44),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );`)
}

export async function getValidatorById(id: number) {
    const res = await pool.query(`SELECT * FROM validators WHERE id=$1`, [id]);
    return res.rows[0]
}

export async function confirmTransfer(transfer_info:any): Promise<[boolean,boolean,boolean]> {
    if (!transfer_info.source || !transfer_info.destination || !transfer_info.amount) {
        return [false,false,false]
    }
    const {source, destination, signature, amount, blockTime, chatId} = transfer_info;
    const isUnique = await ensureUniqueAddress(source);
    const res = await pool.query(`SELECT * FROM transfers WHERE destination=$1 AND amount=$2 AND chatId=$3 AND confirmed=false;`, [destination,amount,chatId]);
    
    let returnFunds = false
    
    
    
    if (res.rows.length > 0)  {
        const blockTimeTimestamp = new Date(blockTime * 1000);
        if (!(blockTimeTimestamp <= res.rows[0].created_at)) {
            
            if (Number(res.rows[0].amount) === Number(amount)) {
                await pool.query(`UPDATE transfers SET confirmed=TRUE, signature=$1, source=$2 WHERE destination=$3 AND amount=$4`, [signature, source, destination, amount]);
                if (!isUnique) {
                    return [true,true,false]
                }
                return [true,true,true]
            }else {
                returnFunds = true
            }
        }
        
    }
    
    await pool.query(`DELETE FROM transfers WHERE chatid=$1 AND confirmed=FALSE`, [chatId]);
    return [false,returnFunds,false]
}


export async function ensureUniqueAddress(source:string) {
    const res = await pool.query(`SELECT * FROM transfers WHERE source=$1`, [source]);
    return res.rows.length === 0;
    
}

export async function checkSignaturesExist(signatures: string[]): Promise<string[]> {
    const query = `
        SELECT signature 
        FROM transfers 
        WHERE signature = ANY($1::BYTEA[])
    `;
    const res = await pool.query(query, [signatures]);
    const existingSignatures = res.rows.map(row => row.signature.toString('hex'));
    return signatures.filter(signature => !existingSignatures.includes(signature));
}


export async function databaseCheck(ENV:any) {
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
}

export async function getDistinctUsers() {
    try {
        const res = await pool.query(`SELECT DISTINCT chatid FROM transfers WHERE confirmed=TRUE`);
        return res.rows;
    } catch (e) {
        console.error(`Error getting distinct users: ${e}`);
        return []
    }
}