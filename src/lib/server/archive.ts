// Pulls the inverter's own 5-minute archive into the intervals table. The
// Datamanager keeps a rolling window (roughly nine months), so the first run
// walks backwards until it runs out of data; later runs just refresh recent days.
import { isPeak, localDate } from '$lib/tou';
import { getConfig } from './config';
import { getDb, kvGet, kvSet } from './db';
import { type ArchiveInterval, inverterClockSkewMs, readArchive } from './fronius';
import { log } from './log';

const DAY = 86_400_000;
const CHUNK_DAYS = 7;
const MAX_BACKFILL_DAYS = 800;

function addDays(date: string, n: number): string {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
}

const INTERVAL = 5 * 60_000;

/**
 * The archive is stamped with the inverter's own clock, which can drift (one
 * was found 23 minutes fast). Shift intervals back by the skew measured on
 * live polls, in whole intervals, and drop any that haven't finished yet.
 */
export function correctClock(
	rows: ArchiveInterval[],
	skewMs: number | null,
	now = Date.now()
): ArchiveInterval[] {
	const shift = skewMs === null ? 0 : Math.round(skewMs / INTERVAL) * INTERVAL;
	return rows
		.map((r) =>
			shift ? { ...r, ts: r.ts - shift, isPeak: isPeak(r.ts - shift + INTERVAL / 2) } : r
		)
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
	return correctClock(await readArchive(host, from, to), skew);
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

export async function syncArchive(): Promise<void> {
	if (running) return;
	running = true;
	const host = getConfig().inverterHost;
	try {
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
	}
}
