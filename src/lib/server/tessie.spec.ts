import { describe, expect, it } from 'vitest';
import { parseTessieVehicles } from './tessie';

const vehicle = (charge: Record<string, unknown>) => ({
	vin: 'TEST',
	last_state: {
		charge_state: {
			timestamp: 1790123000000,
			charging_state: 'Charging',
			charger_actual_current: 11,
			charger_voltage: 243,
			charger_power: 3,
			...charge
		}
	}
});

describe('parseTessieVehicles', () => {
	it("uses the car's measured current and voltage, not its rounded kW", () => {
		expect(parseTessieVehicles({ results: [vehicle({})] })).toEqual({
			w: 2673,
			measuredAt: 1790123000000
		});
	});

	it('falls back to the rounded kW when current or voltage is missing', () => {
		expect(parseTessieVehicles({ results: [vehicle({ charger_voltage: null })] })?.w).toBe(3000);
	});

	it('reports zero for a car that has stopped charging', () => {
		expect(
			parseTessieVehicles({
				results: [vehicle({ charging_state: 'Complete', charger_actual_current: 0 })]
			})
		).toEqual({ w: 0, measuredAt: 1790123000000 });
	});

	it('returns nothing when there is no charging data at all', () => {
		expect(parseTessieVehicles({ results: [] })).toBeNull();
		expect(parseTessieVehicles({})).toBeNull();
	});
});
