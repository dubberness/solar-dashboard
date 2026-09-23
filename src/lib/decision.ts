// The traffic-light rules. A card's colour answers one question: how much of
// this cycle would run on peak-rate grid power? Off-peak grid power is fine
// (and the unmetered heating/hot water circuit never runs at peak), so only
// the peak-time portion of a cycle has to be covered by spare solar.

import { effectiveUsageCents } from './costing';
import { formatTime, isPeak, nextChange } from './tou';
import type { Appliance, CardVerdict, ForecastSlot, Tariff } from './types';

const MIN = 60 * 1000;
const STEP = 5 * MIN;
const SLOT = 30 * MIN;
/** Readings this recent are trusted over the forecast. */
const LIVE_HORIZON = 10 * MIN;
/** How long a live-vs-forecast bias correction takes to fade out. */
const BIAS_DECAY = 90 * MIN;

/** Mean fraction of the cycle short of solar at peak, at or below which the card is green. */
export const GO_MAX_SHORTFALL = 0.03;
/**
 * A bigger shortfall still counts as green when solar covers the appliance's
 * typical draw and only the headroom is missing (so it costs nothing at peak).
 */
export const GO_MAX_SHORTFALL_FREE = 0.15;
/** Above this the card is red. */
export const OKAY_MAX_SHORTFALL = 0.5;

export interface DecisionInput {
	now: number;
	/** 5-minute average of pv - load, kW. Null when readings are stale. */
	liveSpareKw: number | null;
	livePvKw: number | null;
	forecast: ForecastSlot[] | null;
	/** Typical general-circuit load (kW) at a point in time, excluding the appliance. */
	baseLoadKw: (ts: number) => number;
	tariff: Tariff;
}

export interface CycleEstimate {
	/** Mean over the whole cycle of (peak ? share of threshold not covered by solar : 0). */
	shortfall: number;
	peakMinutes: number;
	peakGridKwh: number;
}

export function makeSpareModel(input: DecisionInput): (ts: number) => number {
	const { now, liveSpareKw, livePvKw, forecast, baseLoadKw } = input;
	const live = liveSpareKw ?? 0;
	const slotAt = (ts: number) =>
		forecast?.find((s) => ts < s.periodEnd && ts >= s.periodEnd - SLOT) ?? null;

	let bias = 1;
	const nowSlot = slotAt(now);
	if (nowSlot && livePvKw !== null && nowSlot.pvKw > 0.2) {
		bias = Math.min(2, Math.max(0.3, livePvKw / nowSlot.pvKw));
	}

	return (ts: number) => {
		if (ts - now < LIVE_HORIZON) return live;
		const slot = slotAt(ts);
		// No forecast for this time: assume things stay as they are.
		if (!slot) return live;
		const k = 1 + (bias - 1) * Math.exp(-(ts - now) / BIAS_DECAY);
		return slot.pvKw * k - baseLoadKw(ts);
	};
}

export function estimateCycle(
	start: number,
	appliance: Appliance,
	spareAt: (ts: number) => number
): CycleEstimate {
	const steps = Math.max(1, Math.round((appliance.cycleHours * 60 * MIN) / STEP));
	let shortfallSum = 0;
	let peakSteps = 0;
	let peakGridKwh = 0;
	for (let i = 0; i < steps; i++) {
		const t = start + i * STEP + STEP / 2;
		if (!isPeak(t)) continue;
		peakSteps++;
		const spare = Math.max(0, spareAt(t));
		shortfallSum += Math.min(1, Math.max(0, 1 - spare / appliance.thresholdKw));
		peakGridKwh += Math.max(0, appliance.typicalKw - spare) * (STEP / (60 * MIN));
	}
	return {
		shortfall: shortfallSum / steps,
		peakMinutes: (peakSteps * STEP) / MIN,
		peakGridKwh
	};
}

type Colour = 'go' | 'okay' | 'wait';

export function colourFor(est: CycleEstimate): Colour {
	if (est.shortfall <= GO_MAX_SHORTFALL) return 'go';
	if (est.peakGridKwh < 0.01 && est.shortfall <= GO_MAX_SHORTFALL_FREE) return 'go';
	if (est.shortfall <= OKAY_MAX_SHORTFALL) return 'okay';
	return 'wait';
}

function scan(
	from: number,
	hours: number,
	step: number,
	pred: (t: number) => boolean
): number | null {
	for (let t = from; t <= from + hours * 60 * MIN; t += step) if (pred(t)) return t;
	return null;
}

function roundCents(c: number): number {
	if (c < 10) return Math.max(1, Math.round(c));
	return Math.round(c / 5) * 5;
}

export function decide(appliance: Appliance, input: DecisionInput): CardVerdict {
	const base = { applianceId: appliance.id, name: appliance.name, icon: appliance.icon };
	const { now } = input;
	if (input.liveSpareKw === null) {
		return {
			...base,
			state: 'nodata',
			headline: 'No data',
			detail: 'Check back soon',
			peakCostCents: null
		};
	}

	const spareAt = makeSpareModel(input);
	const colourAt = (t: number) => colourFor(estimateCycle(t, appliance, spareAt));
	const est = estimateCycle(now, appliance, spareAt);
	const colour = colourFor(est);
	const peakCostCents = est.peakGridKwh * effectiveUsageCents(input.tariff.peakCents, input.tariff);
	const quarter = 15 * MIN;
	// Later start times are tried on quarter-hour boundaries so labels read "9pm", not "9:05pm".
	const nextQuarter = Math.floor(now / quarter) * quarter + quarter;

	if (colour === 'go') {
		let detail: string;
		if (est.peakMinutes === 0) {
			// Nothing at peak. Warn if starting a little later would be too late.
			const firstBad = scan(nextQuarter, 3, quarter, (t) => colourAt(t) !== 'go');
			if (firstBad !== null) {
				// A long cycle started at the last moment can still run into peak, just on sunshine.
				const lastStart = firstBad - quarter;
				const intoPeak = estimateCycle(lastStart, appliance, spareAt).peakMinutes > 0;
				detail = intoPeak
					? `Start by ${formatTime(lastStart, now)} so sunshine covers the peak part`
					: `Start by ${formatTime(lastStart, now)} to beat peak`;
			} else if (isPeak(now)) {
				detail = 'Plenty of sunshine for a full load';
			} else {
				detail = 'Off-peak price';
			}
		} else if (isPeak(now)) {
			const fades = scan(now, 12, STEP, (t) => spareAt(t) < appliance.thresholdKw);
			const peakEnds = scan(now, 12, STEP, (t) => !isPeak(t));
			if (fades === null || (peakEnds !== null && fades >= peakEnds)) {
				detail = 'Running on sunshine';
			} else if (fades - now < 15 * MIN && peakEnds !== null) {
				// Green because peak is nearly over, not because the sun is strong.
				detail = `Peak price ends at ${formatTime(nextChange(now), now)}`;
			} else {
				detail = `Running on sunshine until about ${formatTime(fades, now)}`;
			}
		} else {
			detail = 'Sunshine should cover the peak part';
		}
		return { ...base, state: 'go', headline: 'Go now', detail, peakCostCents: 0 };
	}

	const nextGo = scan(nextQuarter, 36, quarter, (t) => colourAt(t) === 'go');
	const nextGoText =
		nextGo === null
			? null
			: isPeak(nextGo + STEP)
				? `Sunny from ${formatTime(nextGo, now)}`
				: `Off-peak from ${formatTime(nextGo, now)}`;

	if (colour === 'okay') {
		const cost = `about ${roundCents(peakCostCents)}c`;
		const fading = input.liveSpareKw >= appliance.thresholdKw;
		let detail: string;
		if (peakCostCents < 1) {
			detail = 'Solar should just about cover it';
		} else if (fading) {
			detail = `Solar fading, might use a little peak power (${cost})`;
		} else {
			detail = `Part solar, part peak power (${cost})`;
		}
		if (
			peakCostCents >= 1 &&
			nextGo !== null &&
			nextGo - now <= 60 * MIN &&
			!isPeak(nextGo + STEP)
		) {
			detail = `Uses a little peak power (${cost}). Off-peak from ${formatTime(nextGo, now)}`;
		}
		return { ...base, state: 'okay', headline: 'Okay', detail, peakCostCents };
	}

	const soon = nextGoText ?? 'Not enough sun right now';
	return {
		...base,
		state: 'wait',
		headline: 'Wait',
		detail: input.liveSpareKw >= appliance.thresholdKw ? `Sun won't last. ${soon}` : soon,
		peakCostCents
	};
}
