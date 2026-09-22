import { describe, expect, it } from 'vitest';
import { DEFAULT_TARIFF } from '$lib/costing';
import { isPeak, localMidnight } from '$lib/tou';
import { openDb } from './db';
import { history, rangeFor } from './history';
import { storeDaily } from './solarweb';

function seedDay(db: ReturnType<typeof openDb>, date: string) {
	const stmt = db.prepare(
		`INSERT INTO intervals (ts, pv_wh, import_wh, export_wh, is_peak, source) VALUES (?, ?, ?, ?, ?, 'archive')`
	);
	const start = localMidnight(date);
	for (let i = 0; i < 288; i++) {
		const ts = start + i * 300_000;
		const peak = isPeak(ts + 150_000);
		// 100 Wh of solar per interval, 60 of it exported; 20 Wh imported at peak, 10 off-peak.
		stmt.run(ts, 100, peak ? 20 : 10, 60, peak ? 1 : 0);
	}
}

const at = (iso: string) => Date.parse(iso);

describe('rangeFor', () => {
	it('uses Monday-start weeks and calendar months and years', () => {
		expect(rangeFor('week', '2026-09-23')).toEqual({ from: '2026-09-21', to: '2026-09-28' });
		expect(rangeFor('month', '2026-12-15')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
		expect(rangeFor('year', '2025-06-01')).toEqual({ from: '2025-01-01', to: '2026-01-01' });
	});
});

describe('history', () => {
	it('totals interval days exactly, splitting peak and off-peak', () => {
		const db = openDb(':memory:');
		seedDay(db, '2026-09-23'); // Wednesday: 8 peak hours = 96 intervals
		const r = history('day', '2026-09-23', [DEFAULT_TARIFF], db, at('2026-09-24T12:00:00+10:00'));
		expect(r.totals.pvKwh).toBeCloseTo(28.8);
		expect(r.totals.exportKwh).toBeCloseTo(17.28);
		expect(r.totals.importPeakKwh).toBeCloseTo(96 * 0.02);
		expect(r.totals.importOffKwh).toBeCloseTo(192 * 0.01);
		expect(r.totals.selfPeakKwh).toBeCloseTo(96 * 0.04);
		expect(r.totals.estimated).toBe(false);
		expect(r.series).toHaveLength(288);
	});

	it('estimates the peak split of Solar.web days from months with interval data', () => {
		const db = openDb(':memory:');
		// Enough September data (over 5 kWh imported) for the ratio to be trusted.
		for (const d of ['2026-09-21', '2026-09-22', '2026-09-23']) seedDay(db, d);
		storeDaily([{ date: '2025-09-23', pvWh: 20000, importWh: 10000, exportWh: 12000 }], db);
		const r = history('day', '2025-09-23', [DEFAULT_TARIFF], db, at('2026-09-24T12:00:00+10:00'));
		const peakShare = (96 * 20) / (96 * 20 + 192 * 10);
		expect(r.totals.estimated).toBe(true);
		expect(r.totals.importPeakKwh).toBeCloseTo(10 * peakShare);
		expect(r.totals.importPeakKwh + r.totals.importOffKwh).toBeCloseTo(10);
	});

	it('compares a month in progress with the same dates last year', () => {
		const db = openDb(':memory:');
		storeDaily(
			[
				{ date: '2025-09-01', pvWh: 10000, importWh: 1000, exportWh: 5000 },
				{ date: '2025-09-02', pvWh: 10000, importWh: 1000, exportWh: 5000 },
				{ date: '2025-09-20', pvWh: 99000, importWh: 1000, exportWh: 5000 }
			],
			db
		);
		seedDay(db, '2026-09-01');
		// On 2 Sep 2026, last year's comparison stops at 2 Sep 2025.
		const r = history('month', '2026-09-02', [DEFAULT_TARIFF], db, at('2026-09-02T12:00:00+10:00'));
		expect(r.lastYearTo).toBe('2026-09-03');
		expect(r.lastYear.days).toBe(2);
		expect(r.lastYear.pvKwh).toBeCloseTo(20);
	});
});
