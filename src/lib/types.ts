export interface Appliance {
	id: string;
	name: string;
	icon: 'washer' | 'dryer';
	/** Spare solar (kW) needed before the card goes green. Includes headroom. */
	thresholdKw: number;
	/** Average draw over a cycle (kW), used for cost estimates. */
	typicalKw: number;
	cycleHours: number;
}

/** Rates exactly as printed on the bill: cents, excluding GST. */
export interface Tariff {
	effectiveFrom: string; // YYYY-MM-DD
	peakCents: number;
	offPeakCents: number;
	supplyCentsPerDay: number;
	feedInCents: number; // not subject to GST
	gstRate: number; // 0.1
	usageDiscountPct: number; // applied to GST-inclusive usage charges
}

export interface LiveReading {
	ts: number; // epoch ms
	pvW: number;
	gridW: number; // + importing, - exporting
	loadW: number; // positive, general circuit only
	importWh: number | null; // meter lifetime counters
	exportWh: number | null;
	/** Car charging power from evcc, and the part it would give up. Absent when unknown. */
	carW?: number | null;
	carFlexW?: number | null;
}

export interface ForecastSlot {
	/** Epoch ms at the END of a 30 minute period (Solcast convention). */
	periodEnd: number;
	pvKw: number;
}

export type CardState = 'go' | 'okay' | 'wait' | 'nodata';

export interface CardVerdict {
	applianceId: string;
	name: string;
	icon: Appliance['icon'];
	state: CardState;
	headline: string;
	detail: string;
	/** Estimated cost of peak-rate grid power for the cycle, in cents (incl GST). */
	peakCostCents: number | null;
}

/** evcc's charging mode: solar only, minimum + solar, fast, or a charging plan. */
export type CarMode = 'pv' | 'minpv' | 'now' | 'plan';

export interface Snapshot {
	now: number;
	stale: boolean;
	live: {
		pvKw: number;
		/** House use, not counting the car. */
		loadKw: number;
		/** Solar not used by the house, counting car charging that would give way. */
		spareKw: number;
		gridKw: number;
		car: { kw: number; mode: CarMode } | null;
	} | null;
	period: { isPeak: boolean; label: string };
	cards: CardVerdict[];
	forecastAvailable: boolean;
}
