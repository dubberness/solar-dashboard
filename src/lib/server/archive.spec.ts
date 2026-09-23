import { describe, expect, it } from 'vitest';
import { correctClock } from './archive';

const MIN = 60_000;
// 10:00 AEST on a Wednesday: the end of morning peak.
const ten = Date.UTC(2026, 8, 23, 0, 0);
const row = (ts: number) => ({ ts, pvWh: 100, importWh: 0, exportWh: 50, isPeak: false });

describe('correctClock', () => {
	it('shifts intervals back by a fast inverter clock, in whole intervals', () => {
		// 23 minutes fast rounds to 25.
		const [r] = correctClock([row(ten + 20 * MIN)], 23 * MIN, ten + 60 * MIN);
		expect(r.ts).toBe(ten - 5 * MIN);
		// 9:55 is still peak, so the flag follows the corrected time.
		expect(r.isPeak).toBe(true);
	});

	it('drops intervals that have not finished yet', () => {
		const rows = correctClock([row(ten), row(ten + 5 * MIN)], 0, ten + 7 * MIN);
		expect(rows.map((r) => r.ts)).toEqual([ten]);
	});

	it('leaves times alone when the clock is right or unknown', () => {
		expect(correctClock([row(ten)], 40_000, ten + 60 * MIN)[0].ts).toBe(ten);
		expect(correctClock([row(ten)], null, ten + 60 * MIN)[0].ts).toBe(ten);
	});
});
