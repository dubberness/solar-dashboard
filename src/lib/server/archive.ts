// Pulls the inverter's own 5-minute archive into the intervals table. The
// Datamanager keeps a rolling window (roughly nine months), so the first run
// walks backwards until it runs out of data; later runs just refresh recent days.
import { isPeak, localDate } from '$lib/tou';
import { getConfig } from './config';
import { getDb, kvGet, kvSet } from './db';
import { type ArchiveInterval, inverterClockSkewMs, readArchive } from './fronius';
import { fillGapsFromReadings } from './live';
import { log } from './log';

const DAY = 86_400_000;
const CHUNK_DAYS = 7;
const MAX_BACKFILL_DAYS = 800;

function addDays(date: string, n: number): string {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
}

const INTERVAL = 5 * 60_000;

/** The inverter's clock was this many minutes fast (negative: slow) until it was set right. */
export interface ClockCorrection {
	/** When the clock was set right, epoch ms. */
	until: number;
	minutesFast: number;
}

/**
 * The archive is stamped with the inverter's own clock, which can drift (one
 * was found 23 minutes fast). Shift intervals back by the error, in whole
 * intervals, and drop any that haven't finished yet. Intervals stamped before
 * a recorded clock fix use that fix's error; later ones use the error measured
 * on live polls. Setting a fast clock back makes it re-record the minutes it
 * had already stamped, so anything stamped after the fix is from after it.
 */
export function correctClock(
	rows: ArchiveInterval[],
	skewMs: number | null,
	now = Date.now(),
	corrections: ClockCorrection[] = []
): ArchiveInterval[] {
	const fixes = [...corrections].sort((a, b) => a.until - b.until);
	const snap = (ms: number) => Math.round(ms / INTERVAL) * INTERVAL;
	return rows
		.map((r) => {
			const fix = fixes.find((c) => r.ts < c.until);
			const shift = snap(fix ? fix.minutesFast * 60_000 : (skewMs ?? 0));
			return shift ? { ...r, ts: r.ts - shift, isPeak: isPeak(r.ts - shift + INTERVAL / 2) } : r;
		})
		.filter((r) => r.ts + INTERVAL <= now);
}

let warnedSkew = false;

async function fetchArchive(host: string, from: string, to: string): Promise<ArchiveInterval[]> {
	const skew = inverterClockSkewMs();
	if (skew !== null && Math.abs(skew) >= 2 * 60_000 && !warnedSkew) {
		warnedSkew = true;
		const mins = Math.round(Math.abs(skew) / 60_000);
		log.warn(
			`Inverter clock is ${mins} min ${skew > 0 ? 'fast' : 'slow'}; correcting archive times. Set its clock in the inverter's web page.`
		);
	}
	return correctClock(
		await readArchive(host, from, to),
		skew,
		Date.now(),
		getConfig().clockCorrections
	);
}

export function storeIntervals(rows: ArchiveInterval[], db = getDb()): number {
	const stmt = db.prepare(
		`INSERT INTO intervals (ts, pv_wh, import_wh, export_wh, is_peak, source)
		 VALUES (?, ?, ?, ?, ?, 'archive')
		 ON CONFLICT(ts) DO UPDATE SET pv_wh = excluded.pv_wh, import_wh = excluded.import_wh,
		   export_wh = excluded.export_wh, is_peak = excluded.is_peak, source = 'archive'`
	);
	db.transaction(() => {
		for (const r of rows) stmt.run(r.ts, r.pvWh, r.importWh, r.exportWh, r.isPeak ? 1 : 0);
	})();
	return rows.length;
}

let running = false;
let rerun = false;

/**
 * Re-read everything the inverter still holds and replace the stored copy, so a
 * new clock correction applies to all of it. Runs on the next sync.
 */
export function requestRebuild(): void {
	kvSet('archive_rebuild', '1');
	if (running) rerun = true;
	else void syncArchive();
}

export function archiveStatus() {
	return {
		lastSync: Number(kvGet('archive_last_sync') ?? 0) || null,
		lastError: kvGet('archive_last_error') || null,
		rebuilding: kvGet('archive_rebuild') === '1',
		rebuiltAt: Number(kvGet('archive_rebuilt_at') ?? 0) || null
	};
}

async function rebuild(host: string, today: string): Promise<void> {
	const rows = new Map<number, ArchiveInterval>();
	let end = today;
	for (let back = 0; back < MAX_BACKFILL_DAYS; back += CHUNK_DAYS) {
		const start = addDays(end, -CHUNK_DAYS);
		const chunk = await fetchArchive(host, start, end);
		if (!chunk.length) break;
		for (const r of chunk) rows.set(r.ts, r);
		end = start;
	}
	if (!rows.size) return;
	// Swap in one go, keeping anything older than the inverter still holds.
	const from = Math.min(...rows.keys());
	const db = getDb();
	db.transaction(() => {
		db.prepare(`DELETE FROM intervals WHERE source = 'archive' AND ts >= ?`).run(from);
		storeIntervals([...rows.values()], db);
	})();
	// Minutes the inverter overwrote when its clock went back only survive in our own readings.
	const filled = fillGapsFromReadings(from);
	kvSet('archive_rebuilt_at', String(Date.now()));
	log.info(`Re-read ${rows.size} intervals from the inverter; filled ${filled} gaps from readings`);
}

export async function syncArchive(): Promise<void> {
	if (running) return;
	running = true;
	const host = getConfig().inverterHost;
	try {
		if (kvGet('archive_rebuild') === '1') {
			await rebuild(host, localDate(Date.now()));
			kvSet('archive_rebuild', '0');
		}
		const today = localDate(Date.now());
		// Recent days: overlap by a day so intervals across chunk edges are complete.
		const recent = await fetchArchive(host, addDays(today, -2), today);
		// Clears rows a fast inverter clock placed in the future before this was corrected.
		getDb()
			.prepare(`DELETE FROM intervals WHERE source = 'archive' AND ts > ?`)
			.run(Date.now() - INTERVAL);
		storeIntervals(recent);
		kvSet('archive_last_sync', String(Date.now()));

		if (kvGet('archive_backfilled') !== '1') {
			// Resume from the oldest archive day already stored, if a previous run was interrupted.
			const oldest = getDb()
				.prepare(
					`SELECT date(min(ts) / 1000, 'unixepoch', '+10 hours') d FROM intervals WHERE source = 'archive'`
				)
				.get() as { d: string | null };
			let end =
				oldest.d && oldest.d < addDays(today, -2) ? addDays(oldest.d, 1) : addDays(today, -2);
			let total = 0;
			for (let back = 0; back < MAX_BACKFILL_DAYS; back += CHUNK_DAYS) {
				const start = addDays(end, -CHUNK_DAYS);
				const rows = await fetchArchive(host, start, end);
				if (!rows.length) break;
				total += storeIntervals(rows);
				end = start;
			}
			kvSet('archive_backfilled', '1');
			log.info(`Inverter archive backfill done: ${total} intervals, back to ${end}`);
		}
		kvSet('archive_last_error', '');
	} catch (e) {
		const msg = (e as Error).message;
		kvSet('archive_last_error', msg);
		log.warn(`Archive sync failed: ${msg}`);
	} finally {
		running = false;
		if (rerun) {
			rerun = false;
			void syncArchive();
		}
	}
}
