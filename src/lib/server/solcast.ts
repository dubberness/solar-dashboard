// Solcast rooftop-site forecasts. The free hobbyist tier allows about 10 calls
// a day, so fetches are spaced out through daylight and counted per day.
import { localDate } from '$lib/tou';
import { getConfig } from './config';
import { getDb, kvGet, kvSet } from './db';
import { log } from './log';

const MIN_GAP_MS = 110 * 60_000;
const MAX_CALLS_PER_DAY = 9;
const FIRST_HOUR = 4;
const LAST_HOUR = 20;

export interface SolcastForecast {
	period_end: string;
	pv_estimate: number;
}

export function parseSolcast(body: { forecasts?: SolcastForecast[] }) {
	return (body.forecasts ?? []).map((f) => ({
		periodEnd: Date.parse(f.period_end),
		pvKw: f.pv_estimate
	}));
}

function hobartHour(ts: number): number {
	return Number(
		new Intl.DateTimeFormat('en-AU', {
			timeZone: 'Australia/Hobart',
			hour: 'numeric',
			hourCycle: 'h23'
		}).format(ts)
	);
}

export function solcastStatus() {
	return {
		lastFetch: Number(kvGet('solcast_last_fetch') ?? 0) || null,
		lastError: kvGet('solcast_last_error'),
		callsToday: Number(kvGet(`solcast_calls_${localDate(Date.now())}`) ?? 0)
	};
}

export async function maybeFetchSolcast(force = false): Promise<void> {
	const { apiKey, resourceId } = getConfig().solcast;
	if (!apiKey || !resourceId) return;
	const now = Date.now();
	const last = Number(kvGet('solcast_last_fetch') ?? 0);
	const callsKey = `solcast_calls_${localDate(now)}`;
	const calls = Number(kvGet(callsKey) ?? 0);
	const hour = hobartHour(now);
	if (!force) {
		if (now - last < MIN_GAP_MS || calls >= MAX_CALLS_PER_DAY) return;
		// Overnight the forecast barely changes; save calls for daylight.
		if ((hour < FIRST_HOUR || hour > LAST_HOUR) && now - last < 12 * 3600_000) return;
	}

	kvSet(callsKey, String(calls + 1));
	kvSet('solcast_last_fetch', String(now));
	try {
		const url = `https://api.solcast.com.au/rooftop_sites/${encodeURIComponent(resourceId)}/forecasts?format=json&hours=48`;
		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal: AbortSignal.timeout(20_000)
		});
		if (!res.ok) throw new Error(`Solcast ${res.status} ${res.statusText}`);
		const slots = parseSolcast(await res.json());
		const db = getDb();
		const insert = db.prepare(
			'INSERT OR REPLACE INTO forecast (period_end, pv_kw, fetched_at) VALUES (?, ?, ?)'
		);
		db.transaction(() => {
			for (const s of slots) insert.run(s.periodEnd, s.pvKw, now);
			db.prepare('DELETE FROM forecast WHERE period_end < ?').run(now - 2 * 86_400_000);
		})();
		kvSet('solcast_last_error', '');
		log.info(`Solcast forecast updated (${slots.length} periods, call ${calls + 1} today)`);
	} catch (e) {
		const msg = (e as Error).message;
		kvSet('solcast_last_error', msg);
		log.warn(`Solcast fetch failed: ${msg}`);
	}
}
