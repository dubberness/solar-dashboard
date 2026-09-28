// Where the solar forecast comes from. ChargeHA already fetches Solcast
// (spending the account's ~10 free calls a day) and serves it locally, so
// reading it from ChargeHA costs no extra Solcast calls. Direct Solcast is the
// fallback for setups without ChargeHA.
import type { ForecastSlot } from '$lib/types';
import { chargehaQuery, chargehaUrl } from './chargeha';
import { getConfig } from './config';
import { getDb, kvGet, kvSet } from './db';
import { log } from './log';
import { maybeFetchSolcast, solcastStatus } from './solcast';

const CHARGEHA_REFRESH_MS = 15 * 60_000;

export type ForecastSource = 'chargeha' | 'solcast' | 'none';

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
 * ChargeHA's forecast.summary carries 30-minute periods stamped at their start,
 * in watts, already corrected by what ChargeHA has learned from the panels'
 * actual output. Only the periods still ahead matter here.
 */
export function parseChargehaForecast(summary: any): ForecastSlot[] {
	const slots: ForecastSlot[] = [];
	for (const p of summary?.periods ?? []) {
		const start = Date.parse(p?.periodStart);
		const minutes = Number(p?.periodMinutes) || 30;
		const watts = Number(p?.pvW);
		if (!Number.isFinite(start) || p?.pvW == null || !Number.isFinite(watts)) continue;
		slots.push({ periodEnd: start + minutes * 60_000, pvKw: watts / 1000 });
	}
	return slots.sort((a, b) => a.periodEnd - b.periodEnd);
}

async function fetchChargeha(force: boolean): Promise<void> {
	if (!chargehaUrl()) return;
	const now = Date.now();
	const last = Number(kvGet('chargeha_last_fetch') ?? 0);
	if (!force && now - last < CHARGEHA_REFRESH_MS) return;
	kvSet('chargeha_last_fetch', String(now));
	try {
		const [summary] = await chargehaQuery(['forecast.summary'], 10_000);
		const slots = parseChargehaForecast(summary);
		if (!slots.some((s) => s.periodEnd > now))
			throw new Error('ChargeHA has no solar forecast set up');
		storeForecast(slots, now);
		if (kvGet('chargeha_last_error')) log.info('ChargeHA forecast working again');
		kvSet('chargeha_last_error', '');
	} catch (e) {
		const msg = (e as Error).message;
		if (msg !== kvGet('chargeha_last_error')) log.warn(`ChargeHA forecast fetch failed: ${msg}`);
		kvSet('chargeha_last_error', msg);
	}
}

export async function refreshForecast(force = false): Promise<void> {
	const { source } = getConfig().forecast;
	if (source === 'chargeha') await fetchChargeha(force);
	else if (source === 'solcast') {
		const slots = await maybeFetchSolcast(force);
		if (slots?.length) storeForecast(slots);
	}
}

export function forecastStatus() {
	const { source } = getConfig().forecast;
	if (source === 'chargeha') {
		return {
			source,
			configured: Boolean(chargehaUrl()),
			lastFetch: Number(kvGet('chargeha_last_fetch') ?? 0) || null,
			lastError: kvGet('chargeha_last_error') || null,
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
