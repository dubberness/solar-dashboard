import { describe, expect, it } from 'vitest';
import { parseChargehaCar } from './chargeha';

// Trimmed from ChargeHA's charger.list for the Tesla via Tessie.
const charger = (over: Record<string, unknown> = {}, state: Record<string, unknown> = {}) => ({
	id: 'cp-VIN1',
	mode: 'auto',
	active: true,
	vehicleId: 'VIN1',
	resolvedVehicleId: 'VIN1',
	...over,
	state: {
		isCharging: true,
		chargeAmps: 10,
		chargeAmpsMin: 5,
		chargePowerKw: 2.4,
		chargerVoltage: 240,
		chargerPhases: 1,
		...state
	}
});
const on = { chargingEnabled: true };
const solarOnly = { solarTrackingEnabled: true, solarTrackingMode: 'solar_only' };
const charge = (over: Record<string, unknown> = {}) => ({
	scheduleType: 'charge' as const,
	chargerId: null,
	vehicleId: null,
	...over
});

describe('parseChargehaCar', () => {
	it('keeps none of a solar-only charge', () => {
		expect(parseChargehaCar([charger()], [], on, solarOnly)).toEqual({
			chargingW: 2400,
			keepW: 0,
			mode: 'pv'
		});
	});

	it('estimates from the set amps when the car reports no voltage yet', () => {
		const c = charger({}, { chargePowerKw: 0.03, chargerVoltage: 2, chargeAmps: 15 });
		expect(parseChargehaCar([c], [], on, solarOnly).chargingW).toBe(3600);
	});

	it('keeps the minimum amps in solar + grid mode', () => {
		const solarGrid = { ...solarOnly, solarTrackingMode: 'solar_grid' };
		expect(parseChargehaCar([charger()], [], on, solarGrid)).toEqual({
			chargingW: 2400,
			keepW: 1200,
			mode: 'minpv'
		});
	});

	it('treats Charge Now as fixed load', () => {
		expect(parseChargehaCar([charger({ mode: 'charge_now' })], [], on, solarOnly)).toEqual({
			chargingW: 2400,
			keepW: Infinity,
			mode: 'now'
		});
	});

	it('treats a running charge schedule for this car as a plan', () => {
		for (const sch of [charge(), charge({ vehicleId: 'VIN1' }), charge({ chargerId: 'cp-VIN1' })]) {
			expect(parseChargehaCar([charger()], [sch], on, solarOnly).mode).toBe('plan');
		}
	});

	it("ignores blockouts and other cars' schedules", () => {
		const other = [
			{ scheduleType: 'blockout' as const, chargerId: null, vehicleId: null },
			charge({ vehicleId: 'VIN2' }),
			charge({ chargerId: 'cp-VIN2' })
		];
		expect(parseChargehaCar([charger()], other, on, solarOnly).mode).toBe('pv');
	});

	it("counts charging ChargeHA isn't controlling as fixed load", () => {
		const off = parseChargehaCar([charger()], [], { chargingEnabled: false }, solarOnly);
		expect(off.mode).toBe('now');
		expect(parseChargehaCar([charger({ active: false })], [], on, solarOnly).mode).toBe('now');
		expect(parseChargehaCar([charger({ mode: 'stop' })], [], on, solarOnly).mode).toBe('now');
		const noTracking = { ...solarOnly, solarTrackingEnabled: false };
		expect(parseChargehaCar([charger()], [], on, noTracking).mode).toBe('now');
	});

	it('ignores a plugged-in car that is not charging', () => {
		const idle = charger({}, { isCharging: false, chargePowerKw: 0.03 });
		expect(parseChargehaCar([idle], [], on, solarOnly)).toEqual({
			chargingW: 0,
			keepW: 0,
			mode: null
		});
		expect(parseChargehaCar([], [], on, solarOnly)).toEqual({ chargingW: 0, keepW: 0, mode: null });
	});
});
