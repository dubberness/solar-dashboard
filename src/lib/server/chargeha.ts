// What the car is doing, from ChargeHA. In auto mode ChargeHA follows the
// solar surplus every 30 seconds and turns the car down (or off) when something
// else starts using it, so that charging counts as spare sunshine for the cards.
import type { CarMode } from '$lib/types';
import { getConfig } from './config';
import { log } from './log';

/** Readings older than this are ignored, so a stopped ChargeHA never inflates "spare". */
const FRESH_MS = 90_000;
/** A 15 A powerpoint gives about 3.6 kW, so about 240 V at the car. */
const VOLTS = 240;

export interface CarPower {
	/** ChargeHA's estimate of what the car(s) are drawing. */
	chargingW: number;
	/** How much of the charge ChargeHA keeps going even without spare solar. */
	keepW: number;
	/** The strictest mode among charging cars, or null when none is charging. */
	mode: CarMode | null;
}

interface CarState extends CarPower {
	ts: number;
}

const g = globalThis as unknown as { __solarCar?: { last: CarState | null; error: string | null } };
const state = (g.__solarCar ??= { last: null, error: null });

export function chargehaUrl(): string {
	return getConfig().chargehaUrl.replace(/\/+$/, '');
}

/**
 * GET a tRPC query (or several, comma-separated, batched into one request) from
 * ChargeHA. These read-only queries need no login.
 */
export async function chargehaQuery(paths: string[], timeoutMs = 8_000): Promise<any[]> {
	const url = chargehaUrl();
	const res = await fetch(`${url}/trpc/${paths.join(',')}?batch=1&input=%7B%7D`, {
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!res.ok) throw new Error(`ChargeHA ${res.status} ${res.statusText}`);
	const body = (await res.json()) as Array<{ result?: { data: unknown }; error?: any }>;
	return body.map((r, i) => {
		if (r.error) throw new Error(`ChargeHA ${paths[i]}: ${r.error.message ?? 'error'}`);
		return r.result?.data;
	});
}

interface Schedule {
	scheduleType: 'charge' | 'blockout';
	chargerId: string | null;
	vehicleId: string | null;
}

/**
 * Work out how much of each charge ChargeHA would give up for the house.
 * ChargeHA's power figure is the amps it set × the car's voltage, which can be
 * more than the car actually takes; live.ts caps it by
 * what the meter sees, and Tessie's measurement wins when set up.
 *
 * "pv": auto mode following solar only, so the whole charge can be given up.
 * "minpv": auto mode set to solar + grid, so only the part above minimum amps is flexible.
 * "plan": a charge schedule is running, which ignores the sun.
 * "now": Charge Now, or charging ChargeHA isn't controlling at all.
 */
export function parseChargehaCar(
	chargers: any[],
	activeSchedules: Schedule[],
	charging: { chargingEnabled?: boolean },
	solar: { solarTrackingEnabled?: boolean; solarTrackingMode?: string }
): CarPower {
	let chargingW = 0;
	let keepW = 0;
	let mode: CarMode | null = null;
	const strictness: CarMode[] = ['pv', 'minpv', 'now', 'plan'];
	const stricter = (m: CarMode) =>
		mode === null || strictness.indexOf(m) > strictness.indexOf(mode) ? m : mode;
	for (const c of chargers ?? []) {
		const s = c?.state;
		if (!s?.isCharging) continue;
		const phases = Number(s.chargerPhases) || 1;
		const reportedW = (Number(s.chargePowerKw) || 0) * 1000;
		const power = reportedW > 100 ? reportedW : (Number(s.chargeAmps) || 0) * VOLTS * phases;
		if (power <= 0) continue;
		chargingW += power;
		const vehicleId = c.resolvedVehicleId ?? c.vehicleId ?? null;
		const scheduled = (activeSchedules ?? []).some(
			(sch) =>
				sch.scheduleType === 'charge' &&
				(sch.chargerId === c.id ||
					(sch.chargerId === null && (sch.vehicleId === null || sch.vehicleId === vehicleId)))
		);
		const automated =
			c.mode === 'auto' && c.active !== false && charging?.chargingEnabled !== false;
		if (automated && scheduled) {
			keepW = Infinity;
			mode = stricter('plan');
		} else if (automated && solar?.solarTrackingEnabled !== false) {
			if (solar?.solarTrackingMode === 'solar_grid') {
				keepW += (Number(s.chargeAmpsMin) || 6) * VOLTS * phases;
				mode = stricter('minpv');
			} else {
				mode = stricter('pv');
			}
		} else {
			keepW = Infinity;
			mode = stricter('now');
		}
	}
	return { chargingW, keepW, mode };
}

export async function pollChargehaCar(): Promise<void> {
	if (!chargehaUrl()) return;
	try {
		const [chargers, active, charging, solar] = await chargehaQuery([
			'charger.list',
			'schedule.active',
			'config.charging.get',
			'config.solar.get'
		]);
		state.last = { ts: Date.now(), ...parseChargehaCar(chargers, active, charging, solar) };
		if (state.error) log.info('ChargeHA car readings resumed');
		state.error = null;
	} catch (e) {
		const msg = (e as Error).message;
		if (msg !== state.error) log.warn(`ChargeHA car poll failed: ${msg}`);
		state.error = msg;
	}
}

/** Latest car power, or null when ChargeHA isn't configured or hasn't answered lately. */
export function carNow(now = Date.now()): CarPower | null {
	const last = state.last;
	if (!last || now - last.ts > FRESH_MS) return null;
	return { chargingW: last.chargingW, keepW: last.keepW, mode: last.mode };
}
