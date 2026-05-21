/**
 * Referral Engine — P2 Business 9.7
 * Multi-tier referral program with reward tracking and fraud detection.
 */

interface Referral {
  id: string;
  referrerId: number;
  referralCode: string;
  refereeId?: number;
  refereeEmail?: string;
  status: "pending" | "registered" | "activated" | "rewarded" | "expired" | "fraudulent";
  rewardAmount: number;
  rewardCurrency: string;
  tier: 1 | 2 | 3;
  createdAt: number;
  activatedAt?: number;
  rewardedAt?: number;
}

interface ReferralProgram {
  tiers: Array<{
    tier: number;
    referralCount: number;
    rewardPerReferral: number;
    bonusReward: number;
  }>;
  maxRewardsPerMonth: number;
  expiryDays: number;
  minTransferForActivation: number;
  rewardCurrency: string;
}

const referrals = new Map<string, Referral>();
const userCodes = new Map<number, string>();

const PROGRAM: ReferralProgram = {
  tiers: [
    { tier: 1, referralCount: 0, rewardPerReferral: 5, bonusReward: 0 },
    { tier: 2, referralCount: 10, rewardPerReferral: 7.5, bonusReward: 25 },
    { tier: 3, referralCount: 25, rewardPerReferral: 10, bonusReward: 100 },
  ],
  maxRewardsPerMonth: 500,
  expiryDays: 90,
  minTransferForActivation: 50,
  rewardCurrency: "USD",
};

export function generateReferralCode(userId: number): string {
  const existing = userCodes.get(userId);
  if (existing) return existing;

  const code = `RF-${userId.toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  userCodes.set(userId, code);
  return code;
}

export function createReferral(referrerId: number, refereeEmail: string): Referral {
  const code = generateReferralCode(referrerId);
  const tier = getUserTier(referrerId);
  const tierConfig = PROGRAM.tiers.find((t) => t.tier === tier) ?? PROGRAM.tiers[0];

  const referral: Referral = {
    id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    referrerId,
    referralCode: code,
    refereeEmail,
    status: "pending",
    rewardAmount: tierConfig.rewardPerReferral,
    rewardCurrency: PROGRAM.rewardCurrency,
    tier,
    createdAt: Date.now(),
  };

  referrals.set(referral.id, referral);
  return referral;
}

export function activateReferral(referralId: string, refereeId: number): boolean {
  const referral = referrals.get(referralId);
  if (!referral || referral.status !== "registered") return false;

  // Check for self-referral
  if (referral.referrerId === refereeId) {
    referral.status = "fraudulent";
    return false;
  }

  referral.refereeId = refereeId;
  referral.status = "activated";
  referral.activatedAt = Date.now();
  return true;
}

export function rewardReferral(referralId: string): { rewarded: boolean; amount: number; reason?: string } {
  const referral = referrals.get(referralId);
  if (!referral) return { rewarded: false, amount: 0, reason: "Not found" };
  if (referral.status !== "activated") return { rewarded: false, amount: 0, reason: `Status: ${referral.status}` };

  // Check monthly cap
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  let monthlyTotal = 0;
  referrals.forEach((r) => {
    if (r.referrerId === referral.referrerId && r.status === "rewarded" && r.rewardedAt && r.rewardedAt >= monthStart.getTime()) {
      monthlyTotal += r.rewardAmount;
    }
  });

  if (monthlyTotal + referral.rewardAmount > PROGRAM.maxRewardsPerMonth) {
    return { rewarded: false, amount: 0, reason: "Monthly cap reached" };
  }

  referral.status = "rewarded";
  referral.rewardedAt = Date.now();
  return { rewarded: true, amount: referral.rewardAmount };
}

function getUserTier(userId: number): 1 | 2 | 3 {
  let count = 0;
  referrals.forEach((r) => {
    if (r.referrerId === userId && (r.status === "activated" || r.status === "rewarded")) count++;
  });

  if (count >= 25) return 3;
  if (count >= 10) return 2;
  return 1;
}

export function getReferralStats(userId: number): {
  tier: number;
  totalReferrals: number;
  activeReferrals: number;
  totalEarned: number;
  monthlyEarned: number;
  code: string;
} {
  const code = generateReferralCode(userId);
  let totalReferrals = 0, activeReferrals = 0, totalEarned = 0, monthlyEarned = 0;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  referrals.forEach((r) => {
    if (r.referrerId !== userId) return;
    totalReferrals++;
    if (r.status === "activated" || r.status === "rewarded") activeReferrals++;
    if (r.status === "rewarded") {
      totalEarned += r.rewardAmount;
      if (r.rewardedAt && r.rewardedAt >= monthStart.getTime()) monthlyEarned += r.rewardAmount;
    }
  });

  return {
    tier: getUserTier(userId),
    totalReferrals,
    activeReferrals,
    totalEarned,
    monthlyEarned,
    code,
  };
}

export function getProgramDetails(): ReferralProgram {
  return { ...PROGRAM };
}
