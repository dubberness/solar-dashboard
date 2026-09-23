// What the car is doing, from evcc. In solar-only ("pv") mode evcc re-balances
// every 30 seconds and turns the car down (or off) when something else starts
// using the surplus, so that charging counts as spare sunshine for the cards.
import { getConfig } from './config';
import { log } from './log';

/** Readings older than this are ignored, so a stopped evcc never inflates "spare". */
const FRESH_MS = 90_000;
const VOLTS = 230;

export interface CarPower {
	/** Everything the car(s) are drawing right now. */
	chargingW: number;
	/** The part evcc would give up if the house needed it. */
	flexibleW: number;
}

interface CarState extends CarPower {
	ts: number;
}

const g = globalThis as unknown as { __solarCar?: { last: CarState | null; error: string | null } };
const state = (g.__solarCar ??= { last: null, error: null });

/**
 * "pv": solar only, so the whole charge can be given up.
 * "minpv": keeps at least the minimum current, so only the part above it is flexible.
 * "now", or a charging plan: charges regardless, so none of it is.
 */
export function parseEvccCar(body: any): CarPower {
	const site = body?.result ?? body;
	let chargingW = 0;
	let flexibleW = 0;
	for (const lp of site?.loadpoints ?? []) {
		const power = Number(lp?.chargePower) || 0;
		if (!lp?.charging || power <= 0) continue;
		chargingW += power;
		if (lp.planActive) continue;
		if (lp.mode === 'pv') flexibleW += power;
		else if (lp.mode === 'minpv') {
			const minW = (Number(lp.minCurrent) || 6) * VOLTS * (Number(lp.phasesActive) || 1);
			flexibleW += Math.max(0, power - minW);
		}
	}
	return { chargingW, flexibleW };
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
	return { chargingW: last.chargingW, flexibleW: last.flexibleW };
}
