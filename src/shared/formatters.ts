export const FX_FALLBACK_RATE = 84;

export const WEALTH_MILESTONES_INR: number[] = [
  5_00_000,      // ₹5L
  10_00_000,     // ₹10L
  25_00_000,     // ₹25L
  50_00_000,     // ₹50L
  1_00_00_000,   // ₹1 Cr
  1_50_00_000,   // ₹1.5 Cr
  2_00_00_000,   // ₹2 Cr
  3_00_00_000,   // ₹3 Cr
  5_00_00_000,   // ₹5 Cr
  10_00_00_000,  // ₹10 Cr
  25_00_00_000,  // ₹25 Cr
  50_00_00_000   // ₹50 Cr
];

export function formatCompactINR(val: number): string {
  if (!Number.isFinite(val)) return '₹0';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_00_00_000) {
    return `${sign}₹${(abs / 1_00_00_000).toFixed(2)} Cr`;
  }
  if (abs >= 1_00_000) {
    return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`;
  }
  if (abs >= 1_000) {
    return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
  }
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

export function formatExactINR(val: number): string {
  if (!Number.isFinite(val)) return '₹0';
  const sign = val < 0 ? '-' : '';
  return `${sign}₹${Math.round(Math.abs(val)).toLocaleString('en-IN')}`;
}

export function formatCompactUSD(val: number): string {
  if (!Number.isFinite(val)) return '$0';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  }
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}

export function formatExactUSD(val: number): string {
  if (!Number.isFinite(val)) return '$0';
  const sign = val < 0 ? '-' : '';
  return `${sign}$${Math.round(Math.abs(val)).toLocaleString('en-US')}`;
}

export function normalizeInviteCode(raw: string | undefined | null): string {
  if (!raw) return '';
  return String(raw)
    .trim()
    .toUpperCase()
    .replace(/^UW[\-\s]*/i, '')
    .replace(/[^A-Z0-9]/g, '');
}

export function getHoldingOwnerId(h: { userId?: string; ownerId?: string }): string {
  return h.ownerId || h.userId || '';
}
