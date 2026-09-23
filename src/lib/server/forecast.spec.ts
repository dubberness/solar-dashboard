import { describe, expect, it } from 'vitest';
import { parseEvccForecast } from './forecast';

describe('parseEvccForecast', () => {
	// 09:00, 09:15, 09:30 AEST on 23 Sep 2026, as evcc 0.315 reports them.
	const t = 1790118000;

	it('averages 15-minute evcc points into 30-minute slots ending on the half hour', () => {
		const body = {
			forecast: {
				solar: {
					scale: 1.05,
					timeseries: [
						[t, 3000],
						[t + 900, 4000],
						[t + 1800, 5000]
					]
				}
			}
		};
		expect(parseEvccForecast(body)).toEqual([
			{ periodEnd: (t + 1800) * 1000, pvKw: 3.5 },
			{ periodEnd: (t + 3600) * 1000, pvKw: 5 }
		]);
	});

	it('accepts the older { result: ... } envelope', () => {
		const body = { result: { forecast: { solar: { timeseries: [[t, 2000]] } } } };
		expect(parseEvccForecast(body)).toEqual([{ periodEnd: (t + 1800) * 1000, pvKw: 2 }]);
	});

	it('returns nothing when evcc has no solar forecast', () => {
		expect(parseEvccForecast({ forecast: {} })).toEqual([]);
		expect(parseEvccForecast({})).toEqual([]);
	});
});
