// Where the solar forecast comes from. evcc already fetches Solcast (spending
// the account's ~10 free calls a day) and republishes it locally, so reading it
// from evcc costs no extra Solcast calls. Direct Solcast is the fallback for
// setups without evcc.
import type { ForecastSlot } from '$lib/types';
import { getConfig } from './config';
import { getDb, kvGet, kvSet } from './db';
import { log } from './log';
import { maybeFetchSolcast, solcastStatus } from './solcast';

const SLOT_MS = 30 * 60_000;
const EVCC_REFRESH_MS = 15 * 60_000;

export type ForecastSource = 'evcc' | 'solcast' | 'none';

export function storeForecast(slots: ForecastSlot[], now = Date.now(), db = getDb()): void {
	const insert = db.prepare(
		'INSERT OR REPLACE INTO forecast (period_end, pv_kw, fetched_at) VALUES (?, ?, ?)'
	);
	db.transaction(() => {
		for (const s of slots) insert.run(s.periodEnd, s.pvKw, now);
		db.prepare('DELETE FROM forecast WHERE period_end < ?').run(now - 2 * 86_400_000);
	})();
}

/**
 * evcc's /api/state carries forecast.solar.timeseries as [epoch seconds, watts]
 * pairs, one per 15 minutes, stamped at the start of each period. Average them
 * into the 30-minute slots the rest of the app uses.
 */
export function parseEvccForecast(body: any): ForecastSlot[] {
	const state = body?.result ?? body;
	const series: Array<[number, number]> = state?.forecast?.solar?.timeseries ?? [];
	const slots = new Map<number, number[]>();
	for (const point of series) {
		if (!Array.isArray(point) || point.length < 2) continue;
		const [ts, watts] = point;
		if (!Number.isFinite(ts) || !Number.isFinite(watts)) continue;
		const start = Math.floor((ts * 1000) / SLOT_MS) * SLOT_MS;
		const list = slots.get(start) ?? [];
		list.push(watts);
		slots.set(start, list);
	}
	return [...slots.entries()]
		.sort(([a], [b]) => a - b)
		.map(([start, ws]) => ({
			periodEnd: start + SLOT_MS,
			pvKw: ws.reduce((s, w) => s + w, 0) / ws.length / 1000
		}));
}

async function fetchEvcc(force: boolean): Promise<void> {
	const url = getConfig().forecast.evccUrl.replace(/\/+$/, '');
	if (!url) return;
	const now = Date.now();
	const last = Number(kvGet('evcc_last_fetch') ?? 0);
	if (!force && now - last < EVCC_REFRESH_MS) return;
	kvSet('evcc_last_fetch', String(now));
	try {
		const res = await fetch(`${url}/api/state`, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) throw new Error(`evcc ${res.status} ${res.statusText}`);
		const slots = parseEvccForecast(await res.json());
		if (!slots.length) throw new Error('evcc has no solar forecast configured');
		storeForecast(slots, now);
		if (kvGet('evcc_last_error')) log.info('evcc forecast working again');
		kvSet('evcc_last_error', '');
	} catch (e) {
		const msg = (e as Error).message;
		if (msg !== kvGet('evcc_last_error')) log.warn(`evcc forecast fetch failed: ${msg}`);
		kvSet('evcc_last_error', msg);
	}
}

export async function refreshForecast(force = false): Promise<void> {
	const { source } = getConfig().forecast;
	if (source === 'evcc') await fetchEvcc(force);
	else if (source === 'solcast') {
		const slots = await maybeFetchSolcast(force);
		if (slots?.length) storeForecast(slots);
	}
}

export function forecastStatus() {
	const { source, evccUrl } = getConfig().forecast;
	if (source === 'evcc') {
		return {
			source,
			configured: Boolean(evccUrl),
			lastFetch: Number(kvGet('evcc_last_fetch') ?? 0) || null,
			lastError: kvGet('evcc_last_error') || null,
			callsToday: null as number | null
		};
	}
	const s = solcastStatus();
	const { apiKey, resourceId } = getConfig().solcast;
	return {
		source,
		configured: source === 'solcast' && Boolean(apiKey && resourceId),
		lastFetch: s.lastFetch,
		lastError: s.lastError || null,
		callsToday: s.callsToday
	};
}
