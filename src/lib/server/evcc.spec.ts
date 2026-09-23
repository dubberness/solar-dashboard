import { describe, expect, it } from 'vitest';
import { parseEvccCar } from './evcc';

const lp = (over: Record<string, unknown>) => ({
	mode: 'pv',
	charging: true,
	chargePower: 2000,
	minCurrent: 5,
	phasesActive: 1,
	planActive: false,
	...over
});

describe('parseEvccCar', () => {
	it('counts all of a solar-only charge as flexible', () => {
		expect(parseEvccCar({ loadpoints: [lp({})] })).toEqual({ chargingW: 2000, flexibleW: 2000 });
	});

	it('keeps the minimum current in min+solar mode', () => {
		// 5 A on one phase is 1150 W that evcc keeps drawing from the grid if it must.
		expect(parseEvccCar({ loadpoints: [lp({ mode: 'minpv' })] })).toEqual({
			chargingW: 2000,
			flexibleW: 850
		});
	});

	it('treats fast charging and charging plans as fixed load', () => {
		expect(parseEvccCar({ loadpoints: [lp({ mode: 'now', chargePower: 3500 })] })).toEqual({
			chargingW: 3500,
			flexibleW: 0
		});
		expect(parseEvccCar({ loadpoints: [lp({ planActive: true })] })).toEqual({
			chargingW: 2000,
			flexibleW: 0
		});
	});

	it('ignores a plugged-in car that is not charging', () => {
		expect(parseEvccCar({ result: { loadpoints: [lp({ charging: false })] } })).toEqual({
			chargingW: 0,
			flexibleW: 0
		});
		expect(parseEvccCar({})).toEqual({ chargingW: 0, flexibleW: 0 });
	});
});
