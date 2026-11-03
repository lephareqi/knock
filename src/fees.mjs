const LAMPORTS_PER_SOL = 1_000_000_000n;
const PLATFORM_FEE_BPS = 50n;
const BPS_DENOMINATOR = 10_000n;
const MAX_SAFE_LAMPORTS = BigInt(Number.MAX_SAFE_INTEGER);

export function parseSolToLamports(value) {
  const normalized = value.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{0,9}))?$/.exec(normalized);

  if (!match) {
    throw new Error("Enter a non-negative SOL amount with up to 9 decimal places.");
  }

  const fraction = (match[2] ?? "").padEnd(9, "0");
  const lamports = BigInt(match[1]) * LAMPORTS_PER_SOL + BigInt(fraction || "0");

  if (lamports > MAX_SAFE_LAMPORTS) {
    throw new Error("The SOL amount is too large to represent safely.");
  }

  return lamports;
}

export function calculatePlatformFeeLamports(initialBuyLamports) {
  if (initialBuyLamports < 0n) {
    throw new Error("Initial buy cannot be negative.");
  }

  return (initialBuyLamports * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
}

export function formatLamportsAsSol(lamports) {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, "0");
  return `${whole}.${fraction} SOL`;
}
