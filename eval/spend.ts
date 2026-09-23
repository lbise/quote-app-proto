const nanoUsdPerUsd = 1_000_000_000n;
const maximumNanoUsd = 1_000_000n * nanoUsdPerUsd;

/** Parse the decimal cap without floating-point multiplication or rounding up. */
export function parseSpendUsd(value: string | number): { usd: number; nanoUsd: number } {
  const invalid = () => new Error("USD must be a positive amount up to 1000000 with at most 9 decimal places.");
  let decimal = String(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 1e-9 || value > 1_000_000) throw invalid();
    // Numeric plans serialize small valid amounts as e.g. 1e-9. Expand only
    // numeric inputs; browser and CLI text must use ordinary decimal notation.
    const scientific = /^(\d)(?:\.(\d+))?e-(\d+)$/.exec(decimal);
    if (scientific) decimal = `0.${"0".repeat(Number(scientific[3]) - 1)}${scientific[1]}${scientific[2] ?? ""}`;
  }
  if (!/^\d+(?:\.\d{1,9})?$/.test(decimal)) throw invalid();
  const [whole, fraction = ""] = decimal.split(".");
  const nanoUsd = BigInt(whole) * nanoUsdPerUsd + BigInt(fraction.padEnd(9, "0"));
  if (nanoUsd <= 0n || nanoUsd > maximumNanoUsd) throw invalid();
  // The validated integer is at most 10^15, below Number.MAX_SAFE_INTEGER.
  return { usd: Number(nanoUsd) / Number(nanoUsdPerUsd), nanoUsd: Number(nanoUsd) };
}
