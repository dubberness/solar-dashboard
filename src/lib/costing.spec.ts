import { describe, expect, it } from 'vitest';
import { DEFAULT_TARIFF, effectiveUsageCents, tariffFor } from './costing';

describe('costing', () => {
	it('reproduces the August 2026 bill usage charges', () => {
		// 97.602 kWh peak + 969.734 kWh off-peak; bill shows $32.01 + $149.34 ex GST,
		// and a 4% discount of $7.98 on the GST-inclusive total.
		const t = DEFAULT_TARIFF;
		const exGst = 97.602 * t.peakCents + 969.734 * t.offPeakCents;
		expect(exGst / 100).toBeCloseTo(181.35, 1);
		const charged =
			97.602 * effectiveUsageCents(t.peakCents, t) +
			969.734 * effectiveUsageCents(t.offPeakCents, t);
		expect(charged / 100).toBeCloseTo(181.35 * 1.1 - 7.98, 1);
	});

	it('picks the tariff in force on a date', () => {
		const older = { ...DEFAULT_TARIFF, effectiveFrom: '2025-07-01', peakCents: 30 };
		const newer = { ...DEFAULT_TARIFF, effectiveFrom: '2026-07-01', peakCents: 32.8 };
		expect(tariffFor([newer, older], '2026-01-01').peakCents).toBe(30);
		expect(tariffFor([newer, older], '2026-08-01').peakCents).toBe(32.8);
		expect(tariffFor([newer, older], '2020-01-01').peakCents).toBe(30);
	});
});
