import { describe, expect, it } from 'vitest';
import { parseEvccCar } from './evcc';

const lp = (over: Record<string, unknown>) => ({
	mode: 'pv',
	charging: true,
	chargePower: 2000,
	offeredCurrent: 10,
	minCurrent: 5,
	phasesActive: 1,
	planActive: false,
	...over
});

describe('parseEvccCar', () => {
	it('keeps none of a solar-only charge', () => {
		expect(parseEvccCar({ loadpoints: [lp({})] })).toEqual({ chargingW: 2400, keepW: 0 });
	});

	it("uses evcc's offered current rather than the Tesla's rounded power", () => {
		// Seen live: 15 A offered on a 15 A powerpoint while the car reported 2 kW.
		expect(parseEvccCar({ loadpoints: [lp({ offeredCurrent: 15 })] }).chargingW).toBe(3600);
		expect(parseEvccCar({ loadpoints: [lp({ offeredCurrent: 0 })] }).chargingW).toBe(2000);
	});

	it('keeps the minimum current in min+solar mode', () => {
		// 5 A on one phase is 1200 W that evcc keeps drawing from the grid if it must.
		expect(parseEvccCar({ loadpoints: [lp({ mode: 'minpv' })] })).toEqual({
			chargingW: 2400,
			keepW: 1200
		});
	});

	it('treats fast charging and charging plans as fixed load', () => {
		expect(parseEvccCar({ loadpoints: [lp({ mode: 'now', offeredCurrent: 15 })] })).toEqual({
			chargingW: 3600,
			keepW: Infinity
		});
		expect(parseEvccCar({ loadpoints: [lp({ planActive: true })] })).toEqual({
			chargingW: 2400,
			keepW: Infinity
		});
	});

	it('ignores a plugged-in car that is not charging', () => {
		expect(parseEvccCar({ result: { loadpoints: [lp({ charging: false })] } })).toEqual({
			chargingW: 0,
			keepW: 0
		});
		expect(parseEvccCar({})).toEqual({ chargingW: 0, keepW: 0 });
	});
});
