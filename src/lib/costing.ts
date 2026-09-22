import type { Tariff } from './types';

export const DEFAULT_TARIFF: Tariff = {
	effectiveFrom: '2000-01-01',
	peakCents: 32.8,
	offPeakCents: 15.4,
	supplyCentsPerDay: 156.6,
	feedInCents: 9.276,
	gstRate: 0.1,
	usageDiscountPct: 4
};

/** Effective cost of one grid kWh, as the bill works it out: +GST, then the usage discount. */
export function effectiveUsageCents(baseCents: number, t: Tariff): number {
	return baseCents * (1 + t.gstRate) * (1 - t.usageDiscountPct / 100);
}

export function tariffFor(tariffs: Tariff[], date: string): Tariff {
	const sorted = [...tariffs].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
	let chosen = sorted[0] ?? DEFAULT_TARIFF;
	for (const t of sorted) if (t.effectiveFrom <= date) chosen = t;
	return chosen;
}

export interface EnergySplit {
	peakImportKwh: number;
	offPeakImportKwh: number;
	exportKwh: number;
	peakSelfKwh: number;
	offPeakSelfKwh: number;
}

/**
 * What the solar was worth: grid power it displaced (at the rate that would
 * have applied) plus feed-in credit. Only covers the metered general circuit.
 */
export function solarValueCents(e: EnergySplit, t: Tariff): number {
	return (
		e.peakSelfKwh * effectiveUsageCents(t.peakCents, t) +
		e.offPeakSelfKwh * effectiveUsageCents(t.offPeakCents, t) +
		e.exportKwh * t.feedInCents
	);
}

export function importCostCents(e: EnergySplit, t: Tariff): number {
	return (
		e.peakImportKwh * effectiveUsageCents(t.peakCents, t) +
		e.offPeakImportKwh * effectiveUsageCents(t.offPeakCents, t)
	);
}
