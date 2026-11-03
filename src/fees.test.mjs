import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePlatformFeeLamports,
  formatLamportsAsSol,
  parseSolToLamports,
} from "./fees.mjs";

test("parses SOL decimals exactly into lamports", () => {
  assert.equal(parseSolToLamports("1.234567891"), 1_234_567_891n);
  assert.equal(parseSolToLamports("0.1"), 100_000_000n);
  assert.equal(parseSolToLamports("0"), 0n);
});

test("rejects amounts with more than 9 decimal places or unsafe size", () => {
  assert.throws(() => parseSolToLamports("0.0000000001"));
  assert.throws(() => parseSolToLamports("9007199.254740992"));
  assert.throws(() => parseSolToLamports("-1"));
});

test("calculates 0.5% of the initial buy, rounded down to a lamport", () => {
  assert.equal(calculatePlatformFeeLamports(100_000_000n), 500_000n);
  assert.equal(
    formatLamportsAsSol(calculatePlatformFeeLamports(100_000_000n)),
    "0.000500000 SOL",
  );
  assert.equal(calculatePlatformFeeLamports(199n), 0n);
  assert.equal(calculatePlatformFeeLamports(200n), 1n);
  assert.equal(calculatePlatformFeeLamports(0n), 0n);
});
