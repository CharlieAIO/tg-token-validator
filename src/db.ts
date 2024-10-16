import {Pool} from "pg"

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
        validatorId INT DEFAULT NULL,
        chatId NUMERIC DEFAULT NULL,
        mint VARCHAR(44),
        source VARCHAR(44),
        destination VARCHAR(44),
        amount NUMERIC(8, 2),
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

export async function confirmTransfer(transfer_info:any): Promise<[boolean,boolean]> {
    if (!transfer_info.source || !transfer_info.destination || !transfer_info.amount) {
        return [false,false]
    }
    const {source, destination, signature, amount, blockTime,mint, chatId} = transfer_info;
    
    const res = await pool.query(`SELECT * FROM transfers WHERE source=$1 AND destination=$2 AND amount=$3 AND confirmed=false;`, [source,destination,amount]);
    
    let returnFunds = false
    
    
    if (res.rows.length > 0)  {
        const blockTimeTimestamp = new Date(blockTime * 1000);
        if (!(blockTimeTimestamp <= res.rows[0].created_at)) {
            
            if (parseFloat(res.rows[0].amount) === parseFloat(amount)) {
                await pool.query(`UPDATE transfers SET confirmed=TRUE, signature=$1 WHERE mint=$2 AND destination=$3 AND amount=$4`, [signature, mint, destination, amount]);
                return [true,true]
            }else {
                returnFunds = true
            }
        }
        
    }
    
    await pool.query(`DELETE FROM transfers WHERE chatid=$1 AND confirmed=FALSE`, [chatId]);
    return [false,returnFunds]
}


export async function checkAmountDoesntExists(mint:string, amount:number) {
    const res = await pool.query(`SELECT * FROM transfers WHERE mint=$1 AND amount=$2`, [mint, amount]);
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