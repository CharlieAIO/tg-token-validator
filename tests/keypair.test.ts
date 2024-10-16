import { expect, test, describe } from "bun:test";
import fs from 'fs';

import {generateKeypairToFile, loadKeypairFromFile} from "../src/utils.ts";
import {Keypair} from "@solana/web3.js";



describe("KeyPair Functions", () => {
    test("Generate a keypair and save it in the wallets folder", async () => {
        const token = "Dogg6xWSgkF8KbsHkTWD3Et4J9a8VBLZjrASURXGiLe1"
        
        const keypair = await generateKeypairToFile(token);
        const wallets = fs.readdirSync('wallets');


        expect(keypair).toHaveProperty('wallet');
        expect(keypair).toHaveProperty('token_account');
        
        expect(wallets).toContain(`${keypair.wallet}.json`);
        
        fs.rmSync(`wallets/${keypair.wallet}.json`);
    });
    
    test("Should not generate a keypair if the token is invalid", async () => {
        const token = "Dogg6xWSgkF8KbsHkTWD3Et4J9a8VBLZSURXGiLe1"

        return expect(async () => {
            await generateKeypairToFile(token);
        }).toThrow("Invalid token address");
        
    });

    test("Should be able to load a keypair after generating.", async () => {
        const token = "Dogg6xWSgkF8KbsHkTWD3Et4J9a8VBLZjrASURXGiLe1"
        
        const {wallet} = await generateKeypairToFile(token);
        
        const kp = loadKeypairFromFile(wallet)
        expect(kp).toBeInstanceOf(Keypair);
        
        fs.rmSync(`wallets/${wallet}.json`);

    });
})