import { describe, expect, it } from 'vitest';
import { parseArchive, parseMeter, parsePowerFlow } from './fronius';

describe('parsePowerFlow', () => {
	it('derives load so pv, grid and load balance, and treats night nulls as zero', () => {
		const body = { Body: { Data: { Site: { P_PV: 3579, P_Grid: 671.5, P_Load: -4250.5 } } } };
		expect(parsePowerFlow(body)).toEqual({ pvW: 3579, gridW: 671.5, loadW: 4250.5 });
		const night = { Body: { Data: { Site: { P_PV: null, P_Grid: 420, P_Load: -420 } } } };
		expect(parsePowerFlow(night)).toEqual({ pvW: 0, gridW: 420, loadW: 420 });
	});
});

describe('parseMeter', () => {
	it('reads the lifetime import and export counters', () => {
		const body = {
			Body: {
				Data: {
					'0': { EnergyReal_WAC_Plus_Absolute: 30823063, EnergyReal_WAC_Minus_Absolute: 28622109 }
				}
			}
		};
		expect(parseMeter(body)).toEqual({ importWh: 30823063, exportWh: 28622109 });
	});
});

describe('parseArchive', () => {
	const start = '2026-09-22T00:00:00+10:00';
	const t0 = Date.parse(start);
	const body = () => ({
		Body: {
			Data: {
				'inverter/1': {
					Start: start,
					Data: { EnergyReal_WAC_Sum_Produced: { Values: { '300': 10, '600': 400 } } }
				},
				'meter:Smart Meter 63A-1': {
					Start: start,
					Data: {
						EnergyReal_WAC_Plus_Absolute: {
							Values: { '0': 1000, '300': 1050, '600': 1050 } as Record<string, number>
						},
						EnergyReal_WAC_Minus_Absolute: { Values: { '0': 500, '300': 500, '600': 820 } }
					}
				}
			}
		}
	});

	it('pairs inverter energy (period ending at its stamp) with meter counter deltas', () => {
		const rows = parseArchive(body());
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ ts: t0, pvWh: 10, importWh: 50, exportWh: 0 });
		expect(rows[1]).toMatchObject({ ts: t0 + 300_000, pvWh: 400, importWh: 0, exportWh: 320 });
		// Midnight on a weekday is off-peak.
		expect(rows[0].isPeak).toBe(false);
	});

	it('skips intervals where a counter goes backwards', () => {
		const broken = body();
		broken.Body.Data['meter:Smart Meter 63A-1'].Data.EnergyReal_WAC_Plus_Absolute.Values['600'] =
			10;
		expect(parseArchive(broken)).toHaveLength(1);
	});
});
