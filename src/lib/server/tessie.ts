// The car's own measurement of what it's drawing, via Tessie. Tessie streams
// from the car and serves its latest values from cache, so polling it neither
// wakes the car nor costs Tesla API credits. Only asked while evcc says the car
// is charging.
import { getConfig } from './config';
import { log } from './log';

/** Charging data older than this is ignored in favour of the estimate. */
const FRESH_MS = 3 * 60_000;

interface TessieState {
	/** Watts measured by the car, and when the car took the measurement. */
	last: { w: number; measuredAt: number } | null;
	lastFetch: number;
	error: string | null;
}

const g = globalThis as unknown as { __solarTessie?: TessieState };
const state = (g.__solarTessie ??= { last: null, lastFetch: 0, error: null });

/**
 * Sum what each car on the account is drawing, from GET /vehicles.
 * The house is single phase, so current × voltage is the whole draw.
 */
export function parseTessieVehicles(body: any): { w: number; measuredAt: number } | null {
	let w = 0;
	let measuredAt = 0;
	for (const v of body?.results ?? []) {
		const cs = v?.last_state?.charge_state;
		if (!cs) continue;
		measuredAt = Math.max(measuredAt, Number(cs.timestamp) || 0);
		if (cs.charging_state !== 'Charging') continue;
		const amps = Number(cs.charger_actual_current) || 0;
		const volts = Number(cs.charger_voltage) || 0;
		w += amps > 0 && volts > 0 ? amps * volts : (Number(cs.charger_power) || 0) * 1000;
	}
	return measuredAt ? { w, measuredAt } : null;
}

export async function pollTessie(): Promise<void> {
	const token = getConfig().tessie.token;
	if (!token) return;
	state.lastFetch = Date.now();
	try {
		const res = await fetch('https://api.tessie.com/vehicles?only_active=true', {
			headers: { Authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(10_000)
		});
		if (res.status === 401 || res.status === 403) throw new Error('Tessie rejected the token');
		if (!res.ok) throw new Error(`Tessie ${res.status} ${res.statusText}`);
		const parsed = parseTessieVehicles(await res.json());
		if (!parsed) throw new Error('Tessie returned no charging data');
		state.last = parsed;
		if (state.error) log.info('Tessie readings resumed');
		state.error = null;
	} catch (e) {
		const msg = (e as Error).message;
		if (msg !== state.error) log.warn(`Tessie poll failed: ${msg}`);
		state.error = msg;
	}
}

/** Measured car power in watts, or null when Tessie isn't set up or its data is old. */
export function tessieCarW(now = Date.now()): number | null {
	const last = state.last;
	if (!last || now - last.measuredAt > FRESH_MS) return null;
	return last.w;
}

export function tessieStatus() {
	return {
		configured: Boolean(getConfig().tessie.token),
		lastFetch: state.lastFetch || null,
		measuredAt: state.last?.measuredAt ?? null,
		lastError: state.error
	};
}
