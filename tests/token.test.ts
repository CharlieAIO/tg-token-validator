import { expect, test, describe } from "bun:test";
import {
    getTokenHoldings,
    lookupDecimals, sendBackBalance,
    validateAddress
} from "../src/utils.ts";


describe("Token/Account Functions", () => {
    
    test("Should be able to validate an address", () => {
        const address = "Dogg6xWSgkF8KbsHkTWD3Et4J9a8VBLZjrASURXGiLe1"
        expect(validateAddress(address)).toBe(true);
    })

    test("Should not be able to validate an invalid address", () => {
        const address = "JBztazvrEokEy7XLKrLMHsDuyjfQP8wkMyb4b6g1Trqm"
        expect(validateAddress(address)).toBe(false);
    })

    test("Should be able to retrieve the token holdings of a wallet", async () => {
        const token = "BuxH23osRyFFLbWG3czrTsfBQYbxzVZ8f7QV4cjTHN5x"
        const wallet = "DW3Z5QVgoMdm47JFmcCR5NXcXifZamJCshQEHCrzBQSP"
        
        const tokenHoldings = await getTokenHoldings(wallet, token);
        expect(tokenHoldings).toBeGreaterThan(0);
    })

    test("Should be able to lookup the decimals of a token", async () => {
        const token = "BuxH23osRyFFLbWG3czrTsfBQYbxzVZ8f7QV4cjTHN5x"
        const expectedDecimals = 6;

        const actualDecimals = await lookupDecimals(token);
        expect(actualDecimals).toBe(expectedDecimals);
    })
    
})