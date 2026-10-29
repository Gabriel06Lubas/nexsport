// Pay-per-session money split ("separate charges and transfers"), in minor
// units. Matches the PaymentTransaction / PaymentTransfer model:
//   amount − platform fee − card processing = net, split between club and coach.

export type FeeSplitInput = {
  /** What the athlete pays, in minor units (cents). */
  amount: number;
  /** Platform take-rate from the payee's SaaS tier (1000 = 10%). */
  platformFeeBps: number;
  /** Coach's share of the net amount (7000 = 70%). */
  coachShareBps: number;
  /** Card processing actually charged by Stripe for this payment. */
  processingFee: number;
};

export type FeeSplit = {
  amount: number;
  platformFee: number;
  processingFee: number;
  clubAmount: number;
  coachAmount: number;
};

function assertBps(name: string, bps: number) {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new RangeError(`${name} must be an integer between 0 and 10000`);
  }
}

export function splitSessionPayment(input: FeeSplitInput): FeeSplit {
  const { amount, platformFeeBps, coachShareBps, processingFee } = input;
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RangeError("amount must be a positive integer of minor units");
  }
  assertBps("platformFeeBps", platformFeeBps);
  assertBps("coachShareBps", coachShareBps);

  const platformFee = Math.round((amount * platformFeeBps) / 10_000);
  const fee = Math.min(Math.max(Math.round(processingFee), 0), amount - platformFee);
  const net = amount - platformFee - fee;
  // Floor the coach share so rounding never pays out more than was collected;
  // the club absorbs the remainder cent.
  const coachAmount = Math.floor((net * coachShareBps) / 10_000);
  return {
    amount,
    platformFee,
    processingFee: fee,
    coachAmount,
    clubAmount: net - coachAmount,
  };
}

/** Card processing for a percentage + fixed pricing model, in minor units. */
export function estimateProcessingFee(amount: number, percentBps: number, fixed: number): number {
  return Math.round((amount * percentBps) / 10_000) + fixed;
}
