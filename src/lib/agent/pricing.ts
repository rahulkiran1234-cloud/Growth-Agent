// List prices per million tokens (input, output). Used only for the cost log, so an estimate:
// Haiku 4.5 is $1/$5; any other model is costed at $3/$15 (Sonnet-class) unless it's Opus-class.
export function costUsd(model: string, inTok: number, outTok: number): number {
  const m = model.toLowerCase();
  const [pin, pout] = m.includes("haiku") ? [1, 5] : m.includes("opus") ? [15, 75] : [3, 15];
  return (inTok * pin + outTok * pout) / 1e6;
}
