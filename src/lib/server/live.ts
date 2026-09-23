// Live polling, 5-minute interval aggregation, and the snapshot pushed to screens.
import { tariffFor } from '$lib/costing';
import { decide, fitsTogether } from '$lib/decision';
import { isPeak, localDate, periodLabel } from '$lib/tou';
import type { CarMode, ForecastSlot, LiveReading, Snapshot } from '$lib/types';
import { getConfig } from './config';
import { getDb } from './db';
import { carNow } from './evcc';
import { inverterClockSkewMs, readLive } from './fronius';
import { tessieCarW } from './tessie';
import { log } from './log';

const MIN = 60_000;
const BUCKET = 5 * MIN;
const STALE_AFTER = 2 * MIN;
const AVG_WINDOW = 5 * MIN;
/** Look-ahead plans for house use at this quantile of the last 14 days (a busy afternoon). */
const BUSY_QUANTILE = 0.75;
/** The house never uses less than about this, so the car can't be all of the metered load. */
const HOUSE_FLOOR_W = 300;

interface LiveState {
	recent: LiveReading[];
	bucket: { start: number; first: LiveReading; readings: LiveReading[] } | null;
	lastError: string | null;
	lastOk: number;
	listeners: Set<(s: Snapshot) => void>;
}

// Kept on globalThis so a dev-server module reload shares state with the
// already-running poll loop instead of starting blank.
const g = globalThis as unknown as { __solarLive?: LiveState };
const state: LiveState = (g.__solarLive ??= {
	recent: [],
	bucket: null,
	lastError: null,
	lastOk: 0,
	listeners: new Set()
});
const { recent, listeners } = state;

export function health() {
	return {
		lastReading: state.lastOk || null,
		lastError: state.lastError,
		stale: Date.now() - state.lastOk > STALE_AFTER,
		clockSkewMs: inverterClockSkewMs()
	};
}

export function subscribe(fn: (s: Snapshot) => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

export async function pollOnce(): Promise<void> {
	const cfg = getConfig();
	try {
		const r = await readLive(cfg.inverterHost);
		const carW = carPower(r);
		const keepW = carNow(r.ts)?.keepW ?? 0;
		record({ ...r, carW, carFlexW: carW === null ? null : Math.max(0, carW - keepW) });
		state.lastOk = r.ts;
		if (state.lastError) log.info('Inverter readings resumed');
		state.lastError = null;
	} catch (e) {
		const msg = (e as Error).message;
		if (msg !== state.lastError) log.warn(`Inverter poll failed: ${msg}`);
		state.lastError = msg;
	}
	if (listeners.size) {
		const snap = snapshot();
		for (const fn of listeners) fn(snap);
	}
}

/**
 * What the car is drawing, in watts, or null when evcc isn't answering. The
 * car's own measurement (via Tessie) wins. Otherwise use what evcc offers the
 * car, which can be more than it takes: the car is on the metered circuit, so
 * cap that at the load less the house's background use.
 */
function carPower(r: LiveReading): number | null {
	const car = carNow(r.ts);
	if (!car) return null;
	if (car.chargingW <= 0) return 0;
	const measured = tessieCarW(r.ts);
	if (measured !== null) return Math.min(measured, r.loadW);
	return Math.min(car.chargingW, Math.max(0, r.loadW - HOUSE_FLOOR_W));
}

function carSummary(r: LiveReading, now: number): { kw: number; mode: CarMode } | null {
	const mode = carNow(now)?.mode;
	if (!mode || (r.carW ?? 0) < 100) return null;
	return { kw: r.carW! / 1000, mode };
}

function record(r: LiveReading): void {
	const db = getDb();
	db.prepare(
		'INSERT OR REPLACE INTO readings (ts, pv_w, grid_w, load_w, import_wh, export_wh, car_w) VALUES (?, ?, ?, ?, ?, ?, ?)'
	).run(r.ts, r.pvW, r.gridW, r.loadW, r.importWh, r.exportWh, r.carW ?? null);

	recent.push(r);
	while (recent.length && recent[0].ts < r.ts - 15 * MIN) recent.shift();

	const start = Math.floor(r.ts / BUCKET) * BUCKET;
	if (!state.bucket || state.bucket.start !== start) {
		if (state.bucket && state.bucket.start === start - BUCKET) closeBucket(state.bucket, r);
		state.bucket = { start, first: r, readings: [] };
	}
	state.bucket.readings.push(r);
}

/** Write a live 5-minute interval unless the inverter archive already has it. */
function closeBucket(b: NonNullable<LiveState['bucket']>, next: LiveReading): void {
	writeInterval(b.start, b.readings, next);
}

/**
 * Turn one bucket's raw readings into a 5-minute interval: mean solar power,
 * and import/export from the meter counters at its start and at the next
 * reading after it. Skipped when the readings cover under half the bucket.
 */
function writeInterval(start: number, readings: LiveReading[], next: LiveReading): boolean {
	const first = readings[0];
	const covered = readings.length ? (readings.at(-1)!.ts - first.ts) / BUCKET : 0;
	if (covered < 0.5 || first.importWh === null || next.importWh === null) return false;
	const meanPv = readings.reduce((s, r) => s + r.pvW, 0) / readings.length;
	const importWh = next.importWh - first.importWh;
	const exportWh = (next.exportWh ?? 0) - (first.exportWh ?? 0);
	if (importWh < 0 || exportWh < 0) return false;
	const db = getDb();
	const carReadings = readings.filter((r) => r.carW != null);
	if (carReadings.length >= readings.length / 2) {
		const meanCar = carReadings.reduce((s, r) => s + r.carW!, 0) / carReadings.length;
		db.prepare('INSERT OR REPLACE INTO car_intervals (ts, car_wh) VALUES (?, ?)').run(
			start,
			(meanCar * BUCKET) / 3600_000
		);
	}
	db.prepare(
		`INSERT INTO intervals (ts, pv_wh, import_wh, export_wh, is_peak, source)
		 VALUES (?, ?, ?, ?, ?, 'live')
		 ON CONFLICT(ts) DO UPDATE SET pv_wh = excluded.pv_wh, import_wh = excluded.import_wh,
		   export_wh = excluded.export_wh WHERE intervals.source = 'live'`
	).run(
		start,
		(meanPv * BUCKET) / 3600_000,
		importWh,
		exportWh,
		isPeak(start + BUCKET / 2) ? 1 : 0
	);
	return true;
}

/**
 * Rebuild missing 5-minute intervals since a time from the raw readings kept
 * for the last 30 days. Returns how many were filled.
 */
export function fillGapsFromReadings(from: number): number {
	const db = getDb();
	const have = new Set(
		(db.prepare('SELECT ts FROM intervals WHERE ts >= ?').all(from) as Array<{ ts: number }>).map(
			(r) => r.ts
		)
	);
	const rows = db
		.prepare(
			`SELECT ts, pv_w, grid_w, load_w, import_wh, export_wh, car_w FROM readings
			 WHERE ts >= ? ORDER BY ts`
		)
		.all(from) as Array<{
		ts: number;
		pv_w: number;
		grid_w: number;
		load_w: number;
		import_wh: number | null;
		export_wh: number | null;
		car_w: number | null;
	}>;
	const readings: LiveReading[] = rows.map((r) => ({
		ts: r.ts,
		pvW: r.pv_w,
		gridW: r.grid_w,
		loadW: r.load_w,
		importWh: r.import_wh,
		exportWh: r.export_wh,
		carW: r.car_w
	}));
	let filled = 0;
	let i = 0;
	while (i < readings.length) {
		const start = Math.floor(readings[i].ts / BUCKET) * BUCKET;
		let j = i;
		while (j < readings.length && readings[j].ts < start + BUCKET) j++;
		// The next reading must follow straight on, or the counters span a gap.
		const next = readings[j];
		if (!have.has(start) && next && next.ts < start + BUCKET + MIN) {
			if (writeInterval(start, readings.slice(i, j), next)) filled++;
		}
		i = j;
	}
	return filled;
}

function forecastFrom(now: number): ForecastSlot[] | null {
	const rows = getDb()
		.prepare('SELECT period_end, pv_kw FROM forecast WHERE period_end > ? ORDER BY period_end')
		.all(now - 30 * MIN) as Array<{ period_end: number; pv_kw: number }>;
	if (!rows.length) return null;
	return rows.map((r) => ({ periodEnd: r.period_end, pvKw: r.pv_kw }));
}

let profile: { builtAt: number; slots: number[] } | null = null;

/** Hobart UTC offset in ms at a moment (+10h or +11h). */
function hobartOffset(ts: number): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Australia/Hobart',
		timeZoneName: 'shortOffset'
	})
		.formatToParts(ts)
		.find((p) => p.type === 'timeZoneName')?.value;
	const m = parts?.match(/GMT([+-]\d+)/);
	return (m ? Number(m[1]) : 10) * 3600_000;
}

/**
 * General-circuit load per local half hour over the last 14 days, not counting
 * the car: the level a busy day (1 in 4) reaches, so looking ahead errs towards
 * less spare solar. Car charging isn't known for intervals from before evcc was
 * polled, so once a half hour has a few days with it known, only those count.
 */
function baseLoadProfile(now: number): number[] {
	if (profile && now - profile.builtAt < 60 * MIN) return profile.slots;
	const rows = getDb()
		.prepare(
			`SELECT i.ts, i.pv_wh + i.import_wh - i.export_wh AS load_wh, c.car_wh
			 FROM intervals i LEFT JOIN car_intervals c ON c.ts = i.ts WHERE i.ts >= ?`
		)
		.all(now - 14 * 24 * 60 * MIN) as Array<{ ts: number; load_wh: number; car_wh: number | null }>;
	const offset = hobartOffset(now);
	const all: number[][] = Array.from({ length: 48 }, () => []);
	const carKnown: number[][] = Array.from({ length: 48 }, () => []);
	for (const r of rows) {
		const slot = Math.floor(
			((((r.ts + offset) % 86_400_000) + 86_400_000) % 86_400_000) / (30 * MIN)
		);
		const kw = (Math.max(0, r.load_wh - (r.car_wh ?? 0)) * 12) / 1000;
		all[slot].push(kw);
		if (r.car_wh !== null) carKnown[slot].push(kw);
	}
	// Six 5-minute intervals per half hour, so 18 is about three days.
	const buckets = all.map((b, i) => (carKnown[i].length >= 18 ? carKnown[i] : b));
	const slots = buckets.map((b) => {
		if (!b.length) return 0.5;
		const s = [...b].sort((x, y) => x - y);
		return s[Math.floor(s.length * BUSY_QUANTILE)];
	});
	profile = { builtAt: now, slots };
	return slots;
}

export function snapshot(now = Date.now()): Snapshot {
	const cfg = getConfig();
	const fresh = now - state.lastOk <= STALE_AFTER;
	const window = recent.filter((r) => r.ts >= now - AVG_WINDOW);
	const latest = recent.at(-1);
	const avg = (f: (r: LiveReading) => number) =>
		window.reduce((s, r) => s + f(r), 0) / Math.max(1, window.length);

	// Car charging that evcc would turn down counts as spare.
	const liveSpareKw =
		fresh && window.length ? avg((r) => r.pvW - r.loadW + (r.carFlexW ?? 0)) / 1000 : null;
	const livePvKw = fresh && window.length ? avg((r) => r.pvW) / 1000 : null;
	const forecast = forecastFrom(now);
	const slots = baseLoadProfile(now);
	const offset = hobartOffset(now);
	const baseLoadKw = (ts: number) =>
		slots[Math.floor(((((ts + offset) % 86_400_000) + 86_400_000) % 86_400_000) / (30 * MIN))];
	const tariff = tariffFor(cfg.tariffs, localDate(now));
	const input = { now, liveSpareKw, livePvKw, forecast, baseLoadKw, tariff };
	const cards = cfg.appliances.map((a) => decide(a, input));
	const green = cfg.appliances.filter((a, i) => cards[i].state === 'go');

	return {
		now,
		stale: !fresh,
		live:
			fresh && latest
				? {
						pvKw: latest.pvW / 1000,
						loadKw: Math.max(0, latest.loadW - (latest.carW ?? 0)) / 1000,
						spareKw: (latest.pvW - latest.loadW + (latest.carFlexW ?? 0)) / 1000,
						gridKw: latest.gridW / 1000,
						car: carSummary(latest, now)
					}
				: null,
		period: periodLabel(now),
		cards,
		oneAtATime: green.length >= 2 && !fitsTogether(green, input),
		forecastAvailable: forecast !== null && forecast.at(-1)!.periodEnd > now + 3 * 60 * MIN
	};
}

/** Raw readings (every poll) since a time, for the realtime chart. House use leaves the car out. */
export function readingsSince(from: number) {
	const rows = getDb()
		.prepare('SELECT ts, pv_w, load_w, car_w FROM readings WHERE ts >= ? ORDER BY ts')
		.all(from) as Array<{ ts: number; pv_w: number; load_w: number; car_w: number | null }>;
	return rows.map((r) => ({
		ts: r.ts,
		pvKw: r.pv_w / 1000,
		useKw: Math.max(0, r.load_w - (r.car_w ?? 0)) / 1000,
		carKw: (r.car_w ?? 0) / 1000
	}));
}

/**
 * The 5-minute interval still being filled, averaged so far, so the Today chart
 * reaches the present instead of stopping at the last finished interval.
 */
export function openInterval() {
	const b = state.bucket;
	if (!b?.readings.length) return null;
	const mean = (f: (r: LiveReading) => number) =>
		b.readings.reduce((s, r) => s + f(r), 0) / b.readings.length / 1000;
	return {
		ts: b.start,
		pvKw: mean((r) => r.pvW),
		useKw: mean((r) => Math.max(0, r.loadW - (r.carW ?? 0))),
		carKw: mean((r) => r.carW ?? 0),
		peak: isPeak(b.start + BUCKET / 2)
	};
}

export function purgeOldReadings(): void {
	getDb()
		.prepare('DELETE FROM readings WHERE ts < ?')
		.run(Date.now() - 30 * 24 * 60 * MIN);
}
