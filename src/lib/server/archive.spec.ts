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

	it('uses a recorded clock fix for intervals stamped before it', () => {
		// Clock 23 min fast until 11:40, right after. Measured skew is now zero.
		const fixedAt = ten + 100 * MIN;
		const fix = [{ until: fixedAt, minutesFast: 23 }];
		const now = ten + 200 * MIN;
		const [before, after] = correctClock([row(ten + 90 * MIN), row(ten + 120 * MIN)], 0, now, fix);
		expect(before.ts).toBe(ten + 65 * MIN);
		expect(after.ts).toBe(ten + 120 * MIN);
	});

	it('applies the earliest matching fix when the clock was wrong more than once', () => {
		const fixes = [
			{ until: ten + 60 * MIN, minutesFast: 10 },
			{ until: ten, minutesFast: -5 }
		];
		const rows = correctClock(
			[row(ten - 30 * MIN), row(ten + 30 * MIN)],
			0,
			ten + 200 * MIN,
			fixes
		);
		expect(rows.map((r) => r.ts)).toEqual([ten - 25 * MIN, ten + 20 * MIN]);
	});
});
