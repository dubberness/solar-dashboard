import { describe, expect, it } from 'vitest';
import { formatTime, isPeak, localDate, localMidnight, nextChange, periodLabel } from './tou';

/** Epoch ms for a wall-clock time in fixed AEST (UTC+10). */
const aest = (y: number, m: number, d: number, h: number, mi = 0) =>
	Date.UTC(y, m - 1, d, h, mi) - 10 * 3600 * 1000;

describe('isPeak', () => {
	it('matches the weekday AEST windows on the bill', () => {
		// Wednesday 23 Sep 2026
		expect(isPeak(aest(2026, 9, 23, 6, 59))).toBe(false);
		expect(isPeak(aest(2026, 9, 23, 7, 0))).toBe(true);
		expect(isPeak(aest(2026, 9, 23, 9, 59))).toBe(true);
		expect(isPeak(aest(2026, 9, 23, 10, 0))).toBe(false);
		expect(isPeak(aest(2026, 9, 23, 15, 59))).toBe(false);
		expect(isPeak(aest(2026, 9, 23, 16, 0))).toBe(true);
		expect(isPeak(aest(2026, 9, 23, 20, 59))).toBe(true);
		expect(isPeak(aest(2026, 9, 23, 21, 0))).toBe(false);
	});

	it('is off-peak all weekend', () => {
		expect(isPeak(aest(2026, 9, 26, 8))).toBe(false); // Saturday
		expect(isPeak(aest(2026, 9, 27, 18))).toBe(false); // Sunday
	});

	it('shifts an hour later on the wall clock during daylight saving', () => {
		// Wednesday 2 Dec 2026, Hobart on AEDT (UTC+11). 5pm local = 4pm AEST.
		const localAedt = (h: number) => Date.UTC(2026, 11, 2, h) - 11 * 3600 * 1000;
		expect(isPeak(localAedt(16))).toBe(false);
		expect(isPeak(localAedt(17))).toBe(true);
		expect(isPeak(localAedt(21))).toBe(true);
		expect(isPeak(localAedt(22))).toBe(false);
		expect(formatTime(localAedt(17))).toBe('5pm');
	});
});

describe('nextChange', () => {
	it('finds the start of the afternoon peak', () => {
		expect(nextChange(aest(2026, 9, 23, 13, 20))).toBe(aest(2026, 9, 23, 16));
	});
	it('skips from Friday evening peak end to Monday morning', () => {
		expect(nextChange(aest(2026, 9, 25, 22))).toBe(aest(2026, 9, 28, 7));
	});
});

describe('labels', () => {
	it('describes the current period', () => {
		expect(periodLabel(aest(2026, 9, 23, 13)).label).toBe('Off-peak until 4pm');
		expect(periodLabel(aest(2026, 9, 23, 17)).label).toBe('Peak price until 9pm');
		expect(periodLabel(aest(2026, 9, 26, 12)).label).toBe('Off-peak all weekend');
	});
	it('names tomorrow when the change is after midnight', () => {
		expect(periodLabel(aest(2026, 9, 23, 22)).label).toBe('Off-peak until 7am tomorrow');
	});
});

describe('local dates', () => {
	it('round-trips Hobart midnight across DST', () => {
		for (const d of ['2026-01-15', '2026-04-05', '2026-07-01', '2026-10-04']) {
			const m = localMidnight(d);
			expect(localDate(m)).toBe(d);
			expect(localDate(m - 1)).not.toBe(d);
		}
	});
});
