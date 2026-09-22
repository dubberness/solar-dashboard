import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseEnergyBalance } from './solarweb';

async function workbook(sheet: string, rows: unknown[][]): Promise<Buffer> {
	const wb = new ExcelJS.Workbook();
	const ws = wb.addWorksheet(sheet);
	for (const r of rows) ws.addRow(r);
	return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('parseEnergyBalance', () => {
	it('reads a Solar.web energy balance export', async () => {
		const buf = await workbook('Energy balance', [
			[
				'Date and time',
				'Total production',
				'Total consumption',
				'Own consumption',
				'Energy to grid',
				'Energy from grid'
			],
			['[dd.MM.yyyy]', '[Wh]', '[Wh]', '[Wh]', '[Wh]', '[Wh]'],
			['01.01.2025', 45351.5, 11225.5, 7083.5, 38268, 4142],
			['02.01.2025', 48667.6, 13227.6, 8134.6, 40533, 5093]
		]);
		expect(await parseEnergyBalance(buf)).toEqual([
			{ date: '2025-01-01', pvWh: 45351.5, importWh: 4142, exportWh: 38268 },
			{ date: '2025-01-02', pvWh: 48667.6, importWh: 5093, exportWh: 40533 }
		]);
	});

	it('converts kWh exports to Wh', async () => {
		const buf = await workbook('Energy balance', [
			['Date and time', 'Total production', 'Energy to grid', 'Energy from grid'],
			['[dd.MM.yyyy]', '[kWh]', '[kWh]', '[kWh]'],
			['15.03.2025', 30.5, 20, 4.25]
		]);
		expect(await parseEnergyBalance(buf)).toEqual([
			{ date: '2025-03-15', pvWh: 30500, importWh: 4250, exportWh: 20000 }
		]);
	});

	it('rejects a production-only export with a useful message', async () => {
		const buf = await workbook('PV Production', [
			['Date and time', 'Energy per inverter | Primo 6.0-1 (1)', 'Total system'],
			['[dd.MM.yyyy]', '[kWh]', '[kWh]'],
			['01.01.2025', 45.35, 45.35]
		]);
		await expect(parseEnergyBalance(buf)).rejects.toThrow(/Energy balance/);
	});
});
