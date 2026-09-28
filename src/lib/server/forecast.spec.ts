import { describe, expect, it } from 'vitest';
import { parseChargehaForecast } from './forecast';

describe('parseChargehaForecast', () => {
	// 11:00 AEST on 28 Sep 2026, as ChargeHA's forecast.summary reports it.
	const start = Date.parse('2026-09-28T01:00:00Z');
	const period = (periodStart: string, pvW: number | null, actualW: number | null = null) => ({
		periodStart,
		periodMinutes: 30,
		pvW,
		pvW10: pvW,
		pvW90: pvW,
		actualW
	});

	it('turns 30-minute periods stamped at their start into slots ending 30 minutes later', () => {
		const summary = {
			today: { date: '2026-09-28' },
			periods: [
				period('2026-09-28T01:30:00Z', 5508.8),
				period('2026-09-28T01:00:00Z', 5375.5, 5015.7)
			]
		};
		expect(parseChargehaForecast(summary)).toEqual([
			{ periodEnd: start + 30 * 60_000, pvKw: 5.3755 },
			{ periodEnd: start + 60 * 60_000, pvKw: 5.5088 }
		]);
	});

	it('skips periods without a forecast', () => {
		expect(parseChargehaForecast({ periods: [period('2026-09-28T01:00:00Z', null)] })).toEqual([]);
	});

	it('returns nothing when ChargeHA has no forecast set up', () => {
		expect(parseChargehaForecast({ today: null, days: [], periods: [] })).toEqual([]);
		expect(parseChargehaForecast(undefined)).toEqual([]);
	});
});
