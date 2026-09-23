import { describe, expect, it } from 'vitest';
import { DEFAULT_TARIFF } from './costing';
import { decide, estimateCycle } from './decision';
import type { Appliance, ForecastSlot } from './types';

const aest = (y: number, m: number, d: number, h: number, mi = 0) =>
	Date.UTC(y, m - 1, d, h, mi) - 10 * 3600 * 1000;

const washer: Appliance = {
	id: 'washer',
	name: 'Washing machine',
	icon: 'washer',
	thresholdKw: 1.3,
	typicalKw: 0.5,
	cycleHours: 1.5
};
const dryer: Appliance = {
	id: 'dryer',
	name: 'Dryer',
	icon: 'dryer',
	thresholdKw: 1.2,
	typicalKw: 0.9,
	cycleHours: 2.5
};

/** Half-hour forecast slots covering [from, from + hours) with a PV curve. */
function forecast(from: number, hours: number, pv: (t: number) => number): ForecastSlot[] {
	const slots: ForecastSlot[] = [];
	// Solcast periods sit on the half hour.
	from = Math.floor(from / 1800e3) * 1800e3;
	for (let t = from; t < from + hours * 3600e3; t += 1800e3) {
		slots.push({ periodEnd: t + 1800e3, pvKw: pv(t + 900e3) });
	}
	return slots;
}

const base = (now: number, spare: number | null, fc: ForecastSlot[] | null = null) => ({
	now,
	liveSpareKw: spare,
	livePvKw: spare === null ? null : spare + 0.5,
	forecast: fc,
	baseLoadKw: () => 0.5,
	tariff: DEFAULT_TARIFF
});

describe('decide', () => {
	it('shows no data when readings are stale', () => {
		expect(decide(washer, base(aest(2026, 9, 23, 17), null)).state).toBe('nodata');
	});

	it('is green off-peak even with no sun, when the cycle ends before peak', () => {
		const v = decide(washer, base(aest(2026, 9, 23, 22), -0.4));
		expect(v.state).toBe('go');
		expect(v.detail).toBe('Off-peak price');
	});

	it('warns to start soon when peak is approaching', () => {
		// 1pm, no sun: washer (1.5h) must start by 2:30pm.
		const v = decide(washer, base(aest(2026, 9, 23, 13), 0));
		expect(v.state).toBe('go');
		expect(v.detail).toBe('Start by 2:30pm to beat peak');
	});

	it('says sunshine covers the end when a long cycle can run into peak', () => {
		// 11:45am, 4-hour dryer, 3 kW of sun until 5pm. Starting at 1pm ends at
		// 5pm: the last hour is at peak but on sunshine. Any later runs past sunset.
		const now = aest(2026, 9, 23, 11, 45);
		const fc = forecast(now - 3600e3, 12, (t) => (t < aest(2026, 9, 23, 17) ? 3 : 0));
		const v = decide({ ...dryer, cycleHours: 4 }, base(now, 2.5, fc));
		expect(v.state).toBe('go');
		expect(v.detail).toBe('Start by 1pm so sunshine covers the peak part');
	});

	it('is green at peak when forecast solar covers the whole cycle', () => {
		const now = aest(2026, 9, 23, 16);
		const fc = forecast(now - 3600e3, 12, () => 4); // 4 kW PV, 0.5 kW base load
		const v = decide(washer, base(now, 3.5, fc));
		expect(v.state).toBe('go');
		expect(v.detail).toBe('Running on sunshine');
	});

	it('says when sunshine runs out if that is before peak ends', () => {
		const now = aest(2026, 9, 23, 16);
		const fadeAt = aest(2026, 9, 23, 19);
		const fc = forecast(now - 3600e3, 12, (t) => (t < fadeAt ? 4 : 0));
		const v = decide(washer, base(now, 3.5, fc));
		expect(v.state).toBe('go');
		expect(v.detail).toBe('Running on sunshine until about 7pm');
	});

	it('goes amber when solar fades partway through the cycle', () => {
		const now = aest(2026, 9, 23, 17);
		const fadeAt = aest(2026, 9, 23, 18, 30);
		const fc = forecast(now - 3600e3, 12, (t) => (t < fadeAt ? 3 : 0));
		const v = decide(dryer, base(now, 2.5, fc));
		expect(v.state).toBe('okay');
		expect(v.detail).toMatch(/^Solar fading/);
		expect(v.peakCostCents).toBeGreaterThan(0);
	});

	it('is red when strong sun now fades early in a long cycle', () => {
		const now = aest(2026, 9, 23, 17);
		const fadeAt = aest(2026, 9, 23, 18);
		const fc = forecast(now - 3600e3, 12, (t) => (t < fadeAt ? 3 : 0));
		const v = decide(dryer, base(now, 2.5, fc));
		expect(v.state).toBe('wait');
		expect(v.detail).toBe("Sun won't last. Off-peak from 9pm");
	});

	it('is red at peak with no sun and points to off-peak', () => {
		const now = aest(2026, 9, 23, 17, 30);
		const fc = forecast(now - 3600e3, 36, () => 0);
		const v = decide(washer, base(now, -1, fc));
		expect(v.state).toBe('wait');
		expect(v.detail).toBe('Off-peak from 9pm');
	});

	it('is amber when only the tail of peak is left', () => {
		// 8:50pm: 10 of 90 minutes at peak.
		const now = aest(2026, 9, 23, 20, 50);
		const v = decide(
			washer,
			base(
				now,
				-1,
				forecast(now - 3600e3, 12, () => 0)
			)
		);
		expect(v.state).toBe('okay');
		expect(v.detail).toMatch(/Off-peak from 9pm$/);
	});

	it('points to tomorrow morning sun when that comes before off-peak', () => {
		// Tuesday 8:05am, overcast now; sunny from 9am. A wash started at 9am
		// covers the 9-10am peak with sun, then finishes off-peak.
		const now = aest(2026, 9, 22, 8, 5);
		const sunny = aest(2026, 9, 22, 9);
		const fc = forecast(now - 3600e3, 12, (t) => (t >= sunny ? 4 : 0.2));
		const v = decide(washer, base(now, -0.3, fc));
		expect(v.state).toBe('wait');
		expect(v.detail).toBe('Sunny from 9am');
	});

	it('is green near the end of peak when solar covers the typical draw', () => {
		// 9:47am, 13 minutes of peak left, 0.8 kW spare: covers the washer's 0.5 kW
		// draw, though not the 1.3 kW headroom.
		const now = aest(2026, 9, 23, 9, 47);
		const v = decide(
			washer,
			base(
				now,
				0.8,
				forecast(now - 3600e3, 12, () => 1.3)
			)
		);
		expect(v.state).toBe('go');
		expect(v.detail).toBe('Peak price ends at 10am');
	});

	it('stays amber at peak when solar covers the draw but not the headroom', () => {
		const now = aest(2026, 9, 23, 17);
		const v = decide(
			washer,
			base(
				now,
				0.8,
				forecast(now - 3600e3, 12, () => 1.3)
			)
		);
		expect(v.state).toBe('okay');
		expect(v.detail).toBe('Solar should just about cover it');
	});

	it('falls back to the live reading when there is no forecast', () => {
		const now = aest(2026, 9, 23, 17);
		expect(decide(washer, base(now, 2, null)).state).toBe('go');
		expect(decide(washer, base(now, 0.2, null)).state).toBe('wait');
	});

	it('trusts live solar over a pessimistic forecast in the near term', () => {
		const now = aest(2026, 9, 23, 16);
		const fc = forecast(now - 3600e3, 12, () => 1); // forecast says 1 kW, reality is 4
		const est = estimateCycle(now, washer, (t) => (t < now + 600e3 ? 3.5 : 0.5));
		expect(est.shortfall).toBeGreaterThan(0.5);
		const v = decide(washer, { ...base(now, 3.5, fc), livePvKw: 4 });
		// Bias correction lifts the forecast to ~2x (capped), enough for the first hour.
		expect(v.state).not.toBe('wait');
	});
});
