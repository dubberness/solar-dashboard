import { solarValueCents, tariffFor } from '$lib/costing';
import { localDate, localMidnight } from '$lib/tou';
import type { Tariff } from '$lib/types';
import { getDb } from './db';

export type Period = 'day' | 'week' | 'month' | 'year';

export interface DayTotals {
	date: string;
	pvKwh: number;
	useKwh: number;
	exportKwh: number;
	importPeakKwh: number;
	importOffKwh: number;
	selfPeakKwh: number;
	selfOffKwh: number;
	/** Peak/off-peak split estimated from a daily total. */
	estimated: boolean;
	source: 'intervals' | 'solarweb' | 'none';
}

export interface Totals extends Omit<DayTotals, 'date' | 'source'> {
	days: number;
	selfConsumptionPct: number | null;
	solarValueDollars: number;
}

export interface HistoryResult {
	period: Period;
	from: string;
	to: string; // exclusive
	label: string;
	buckets: Array<DayTotals & { label: string }>;
	totals: Totals;
	lastYear: Totals;
	/** Last-year comparison covers [from, lastYearTo) shifted back a year; equals `to` unless the period is still under way. */
	lastYearTo: string;
	series?: Array<{ ts: number; pvKw: number; useKw: number; peak: boolean }>;
}

const DAY = 86_400_000;
/** An interval-backed day needs most of its 288 buckets to count as complete. */
const MIN_INTERVALS = 250;

export function addDays(date: string, n: number): string {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
}

function addYears(date: string, n: number): string {
	const [y, m, d] = date.split('-').map(Number);
	// 29 Feb maps to 28 Feb.
	const day = Math.min(d, new Date(Date.UTC(y + n, m, 0)).getUTCDate());
	return `${y + n}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function rangeFor(period: Period, anchor: string): { from: string; to: string } {
	const [y, m] = anchor.split('-').map(Number);
	switch (period) {
		case 'day':
			return { from: anchor, to: addDays(anchor, 1) };
		case 'week': {
			const dow = (new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
			const from = addDays(anchor, -dow);
			return { from, to: addDays(from, 7) };
		}
		case 'month': {
			const from = `${y}-${String(m).padStart(2, '0')}-01`;
			const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
			return { from, to };
		}
		case 'year':
			return { from: `${y}-01-01`, to: `${y + 1}-01-01` };
	}
}

const kwh = (wh: number | null | undefined) => (wh ?? 0) / 1000;

interface IntervalDay {
	n: number;
	pv: number;
	imp: number;
	exp: number;
	impPeak: number;
	selfPeak: number;
}

function intervalDay(date: string, db = getDb()): IntervalDay {
	return db
		.prepare(
			`SELECT count(*) n, total(pv_wh) pv, total(import_wh) imp, total(export_wh) exp,
			   total(CASE WHEN is_peak THEN import_wh ELSE 0 END) impPeak,
			   total(CASE WHEN is_peak THEN max(pv_wh - export_wh, 0) ELSE 0 END) selfPeak
			 FROM intervals WHERE ts >= ? AND ts < ?`
		)
		.get(localMidnight(date), localMidnight(addDays(date, 1))) as IntervalDay;
}

/**
 * Share of import, and of self-used solar, that falls in peak time, per
 * calendar month, learned from days with full interval data. Used to split
 * daily totals from Solar.web, which carry no time-of-day detail.
 */
export function peakShares(db = getDb()): Map<number, { imp: number; self: number }> {
	const rows = db
		.prepare(`SELECT ts, import_wh, max(pv_wh - export_wh, 0) self_wh, is_peak FROM intervals`)
		.all() as Array<{ ts: number; import_wh: number; self_wh: number; is_peak: number }>;
	const acc = new Map<number, { imp: number; impPeak: number; self: number; selfPeak: number }>();
	for (const r of rows) {
		// Month in AEST is close enough for a monthly ratio.
		const month = new Date(r.ts + 10 * 3600_000).getUTCMonth() + 1;
		const a = acc.get(month) ?? { imp: 0, impPeak: 0, self: 0, selfPeak: 0 };
		a.imp += r.import_wh;
		a.self += r.self_wh;
		if (r.is_peak) {
			a.impPeak += r.import_wh;
			a.selfPeak += r.self_wh;
		}
		acc.set(month, a);
	}
	const out = new Map<number, { imp: number; self: number }>();
	for (let m = 1; m <= 12; m++) {
		// Nearest month with enough data, searching outwards.
		for (let dist = 0; dist <= 6; dist++) {
			const cands = [((m - 1 + dist) % 12) + 1, ((m - 1 - dist + 12) % 12) + 1];
			const hit = cands.map((c) => acc.get(c)).find((a) => a && a.imp > 5000 && a.self > 5000);
			if (hit) {
				out.set(m, { imp: hit.impPeak / hit.imp, self: hit.selfPeak / hit.self });
				break;
			}
		}
		if (!out.has(m)) out.set(m, { imp: 0.12, self: 0.15 });
	}
	return out;
}

export function dayTotals(
	date: string,
	shares: Map<number, { imp: number; self: number }>,
	db = getDb()
): DayTotals {
	const iv = intervalDay(date, db);
	const imported = db.prepare('SELECT * FROM daily_import WHERE date = ?').get(date) as
		{ pv_wh: number; import_wh: number; export_wh: number } | undefined;

	if (iv.n >= MIN_INTERVALS || (iv.n > 0 && !imported)) {
		const self = Math.max(0, iv.pv - iv.exp);
		return {
			date,
			pvKwh: kwh(iv.pv),
			useKwh: kwh(iv.pv + iv.imp - iv.exp),
			exportKwh: kwh(iv.exp),
			importPeakKwh: kwh(iv.impPeak),
			importOffKwh: kwh(iv.imp - iv.impPeak),
			selfPeakKwh: kwh(iv.selfPeak),
			selfOffKwh: kwh(self - iv.selfPeak),
			estimated: false,
			source: 'intervals'
		};
	}
	if (imported) {
		const share = shares.get(Number(date.slice(5, 7)))!;
		const self = Math.max(0, imported.pv_wh - imported.export_wh);
		return {
			date,
			pvKwh: kwh(imported.pv_wh),
			useKwh: kwh(imported.pv_wh + imported.import_wh - imported.export_wh),
			exportKwh: kwh(imported.export_wh),
			importPeakKwh: kwh(imported.import_wh * share.imp),
			importOffKwh: kwh(imported.import_wh * (1 - share.imp)),
			selfPeakKwh: kwh(self * share.self),
			selfOffKwh: kwh(self * (1 - share.self)),
			estimated: true,
			source: 'solarweb'
		};
	}
	return {
		date,
		pvKwh: 0,
		useKwh: 0,
		exportKwh: 0,
		importPeakKwh: 0,
		importOffKwh: 0,
		selfPeakKwh: 0,
		selfOffKwh: 0,
		estimated: false,
		source: 'none'
	};
}

export function sumTotals(days: DayTotals[], tariffs: Tariff[]): Totals {
	const present = days.filter((d) => d.source !== 'none');
	const sum = (f: (d: DayTotals) => number) => present.reduce((s, d) => s + f(d), 0);
	const pv = sum((d) => d.pvKwh);
	const self = sum((d) => d.selfPeakKwh + d.selfOffKwh);
	const valueCents = present.reduce(
		(s, d) =>
			s +
			solarValueCents(
				{
					peakImportKwh: d.importPeakKwh,
					offPeakImportKwh: d.importOffKwh,
					exportKwh: d.exportKwh,
					peakSelfKwh: d.selfPeakKwh,
					offPeakSelfKwh: d.selfOffKwh
				},
				tariffFor(tariffs, d.date)
			),
		0
	);
	return {
		days: present.length,
		pvKwh: pv,
		useKwh: sum((d) => d.useKwh),
		exportKwh: sum((d) => d.exportKwh),
		importPeakKwh: sum((d) => d.importPeakKwh),
		importOffKwh: sum((d) => d.importOffKwh),
		selfPeakKwh: sum((d) => d.selfPeakKwh),
		selfOffKwh: sum((d) => d.selfOffKwh),
		estimated: present.some((d) => d.estimated),
		selfConsumptionPct: pv > 0 ? (self / pv) * 100 : null,
		solarValueDollars: valueCents / 100
	};
}

function datesIn(from: string, to: string): string[] {
	const out: string[] = [];
	for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
	return out;
}

const monthName = (date: string, style: 'short' | 'long' = 'short') =>
	new Date(`${date}T00:00:00Z`).toLocaleString('en-AU', { month: style, timeZone: 'UTC' });

function rangeLabel(period: Period, from: string, to: string): string {
	const [y, , d] = from.split('-');
	switch (period) {
		case 'day':
			return new Date(`${from}T00:00:00Z`).toLocaleDateString('en-AU', {
				weekday: 'long',
				day: 'numeric',
				month: 'long',
				year: 'numeric',
				timeZone: 'UTC'
			});
		case 'week': {
			const last = addDays(to, -1);
			return `${Number(d)} ${monthName(from)} – ${Number(last.slice(8))} ${monthName(last)} ${last.slice(0, 4)}`;
		}
		case 'month':
			return `${monthName(from, 'long')} ${y}`;
		case 'year':
			return y;
	}
}

export function history(
	period: Period,
	anchor: string,
	tariffs: Tariff[],
	db = getDb(),
	now = Date.now()
): HistoryResult {
	const { from, to } = rangeFor(period, anchor);
	const shares = peakShares(db);
	const days = datesIn(from, to).map((d) => dayTotals(d, shares, db));
	// A period still under way is compared with the same dates last year, not the whole period.
	const tomorrow = addDays(localDate(now), 1);
	const lastYearTo = to > tomorrow ? tomorrow : to;
	const lastYearDays = datesIn(addYears(from, -1), addYears(lastYearTo, -1)).map((d) =>
		dayTotals(d, shares, db)
	);

	let buckets: HistoryResult['buckets'];
	if (period === 'year') {
		buckets = [];
		for (let m = 0; m < 12; m++) {
			const inMonth = days.filter((d) => Number(d.date.slice(5, 7)) === m + 1);
			const t = sumTotals(inMonth, tariffs);
			buckets.push({
				date: inMonth[0].date,
				label: monthName(inMonth[0].date),
				pvKwh: t.pvKwh,
				useKwh: t.useKwh,
				exportKwh: t.exportKwh,
				importPeakKwh: t.importPeakKwh,
				importOffKwh: t.importOffKwh,
				selfPeakKwh: t.selfPeakKwh,
				selfOffKwh: t.selfOffKwh,
				estimated: t.estimated,
				source: t.days ? inMonth.find((d) => d.source !== 'none')!.source : 'none'
			});
		}
	} else {
		buckets = days.map((d) => ({
			...d,
			label:
				period === 'week'
					? new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-AU', {
							weekday: 'short',
							timeZone: 'UTC'
						})
					: String(Number(d.date.slice(8)))
		}));
	}

	const result: HistoryResult = {
		period,
		from,
		to,
		label: rangeLabel(period, from, to),
		buckets,
		totals: sumTotals(days, tariffs),
		lastYear: sumTotals(lastYearDays, tariffs),
		lastYearTo
	};
	if (period === 'day') result.series = daySeries(from, db);
	return result;
}

export function daySeries(date: string, db = getDb()) {
	const rows = db
		.prepare(
			'SELECT ts, pv_wh, import_wh, export_wh, is_peak FROM intervals WHERE ts >= ? AND ts < ? ORDER BY ts'
		)
		.all(localMidnight(date), localMidnight(addDays(date, 1))) as Array<{
		ts: number;
		pv_wh: number;
		import_wh: number;
		export_wh: number;
		is_peak: number;
	}>;
	return rows.map((r) => ({
		ts: r.ts,
		pvKw: (r.pv_wh * 12) / 1000,
		useKw: Math.max(0, ((r.pv_wh + r.import_wh - r.export_wh) * 12) / 1000),
		peak: r.is_peak === 1
	}));
}
