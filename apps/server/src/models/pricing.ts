/**
 * API list prices in dollars per million tokens, for the one runner that reports no cost. Codex on a
 * ChatGPT login is not billed per call; these turn its tokens into the API-equivalent dollars the
 * daily cap is held against. They are estimates read from price trackers in November 2026, not from
 * a bill. Cached input is counted at the full input price.
 */
const CODEX_USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-6-luna": { input: 0.1, output: 0.5 },
  "gpt-6.1-sol": { input: 2, output: 10 },
  "gpt-6-astra": { input: 10, output: 50 },
  "gpt-5.6-terra": { input: 2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
};

/** A model with no listed price is counted at the dearest one, so the cap errs towards stopping early. */
const UNLISTED = { input: 10, output: 50 };

export function codexEstimateUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = CODEX_USD_PER_MILLION[model] ?? UNLISTED;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
