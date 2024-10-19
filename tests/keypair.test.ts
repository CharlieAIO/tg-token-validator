import { expect, test, describe } from "bun:test";
import fs from 'fs';

import {generateKeypairToFile, loadKeypairFromFile} from "../src/utils.ts";
import {Keypair} from "@solana/web3.js";



describe("KeyPair Functions", () => {
    test("Generate a keypair and save it in the wallets folder", async () => {
        const token = "Dogg6xWSgkF8KbsHkTWD3Et4J9a8VBLZjrASURXGiLe1"
        const chatId = -1;
        
        const keypair = await generateKeypairToFile(token,chatId);
        const wallets = fs.readdirSync('wallets');
        

        expect(keypair).toHaveProperty('wallet');
        expect(keypair).toHaveProperty('tokenAccount');
        
        expect(wallets).toContain(`${chatId}.json`);
        
        fs.rmSync(`wallets/${chatId}.json`);
    });
    
    test("Should not generate a keypair if the token is invalid", async () => {
        const token = "Dogg6xWSgkF8KbsHkTWD3Et4J9a8VBLZSURXGiLe1"
        const chatId = -1;

        return expect(async () => {
            await generateKeypairToFile(token, chatId);
        }).toThrow("Invalid token address");
        
    });

    test("Should be able to load a keypair after generating.", async () => {
        const token = "Dogg6xWSgkF8KbsHkTWD3Et4J9a8VBLZjrASURXGiLe1"
        const chatId = -1;
        
        await generateKeypairToFile(token,chatId);
        
        const [kp,tokenAccount] = loadKeypairFromFile(chatId);
        expect(kp).toBeInstanceOf(Keypair);
        expect(tokenAccount).toBeTypeOf('string');
        
        fs.rmSync(`wallets/${chatId}.json`);

    });
})