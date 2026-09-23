// What the car is doing, from evcc. In solar-only ("pv") mode evcc re-balances
// every 30 seconds and turns the car down (or off) when something else starts
// using the surplus, so that charging counts as spare sunshine for the cards.
import { getConfig } from './config';
import { log } from './log';

/** Readings older than this are ignored, so a stopped evcc never inflates "spare". */
const FRESH_MS = 90_000;
/** A 15 A powerpoint gives about 3.6 kW, so about 240 V at the car. */
const VOLTS = 240;

export interface CarPower {
	/** evcc's estimate of what the car(s) are drawing. */
	chargingW: number;
	/** How much of the charge evcc keeps going even without spare solar. */
	keepW: number;
}

interface CarState extends CarPower {
	ts: number;
}

const g = globalThis as unknown as { __solarCar?: { last: CarState | null; error: string | null } };
const state = (g.__solarCar ??= { last: null, error: null });

/**
 * The Tesla reports its charging power rounded to whole kW and often minutes
 * old, so use the current evcc is offering instead: in pv mode evcc changes it
 * every 30 seconds and the car follows within seconds. The car can take less
 * than it's offered, so live.ts also caps this by what the meter sees.
 *
 * "pv": solar only, so the whole charge can be given up.
 * "minpv": keeps at least the minimum current, so only the part above it is flexible.
 * "now", or a charging plan: charges regardless, so none of it is.
 */
export function parseEvccCar(body: any): CarPower {
	const site = body?.result ?? body;
	let chargingW = 0;
	let keepW = 0;
	for (const lp of site?.loadpoints ?? []) {
		if (!lp?.charging) continue;
		const phases = Number(lp.phasesActive) || 1;
		const offeredA = Number(lp.offeredCurrent) || 0;
		const power = offeredA > 0 ? offeredA * VOLTS * phases : Number(lp.chargePower) || 0;
		if (power <= 0) continue;
		chargingW += power;
		if (lp.planActive || (lp.mode !== 'pv' && lp.mode !== 'minpv')) keepW = Infinity;
		else if (lp.mode === 'minpv') keepW += (Number(lp.minCurrent) || 6) * VOLTS * phases;
	}
	return { chargingW, keepW };
}

export async function pollEvccCar(): Promise<void> {
	const url = getConfig().forecast.evccUrl.replace(/\/+$/, '');
	if (!url) return;
	try {
		const res = await fetch(`${url}/api/state`, { signal: AbortSignal.timeout(8_000) });
		if (!res.ok) throw new Error(`evcc ${res.status} ${res.statusText}`);
		state.last = { ts: Date.now(), ...parseEvccCar(await res.json()) };
		if (state.error) log.info('evcc car readings resumed');
		state.error = null;
	} catch (e) {
		const msg = (e as Error).message;
		if (msg !== state.error) log.warn(`evcc car poll failed: ${msg}`);
		state.error = msg;
	}
}

/** Latest car power, or null when evcc isn't configured or hasn't answered lately. */
export function carNow(now = Date.now()): CarPower | null {
	const last = state.last;
	if (!last || now - last.ts > FRESH_MS) return null;
	return { chargingW: last.chargingW, keepW: last.keepW };
}
