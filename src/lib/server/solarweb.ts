// Imports Solar.web "Energy balance" exports (daily totals in Wh, one row per day).
import ExcelJS from 'exceljs';
import { getDb } from './db';

export interface DailyTotals {
	date: string; // YYYY-MM-DD
	pvWh: number;
	importWh: number;
	exportWh: number;
}

const REQUIRED = ['total production', 'energy to grid', 'energy from grid'];

function toIsoDate(v: unknown): string | null {
	if (v instanceof Date) return v.toISOString().slice(0, 10);
	const m = String(v ?? '').match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
	if (!m) return null;
	return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

export async function parseEnergyBalance(buf: ArrayBuffer | Buffer): Promise<DailyTotals[]> {
	const wb = new ExcelJS.Workbook();
	await wb.xlsx.load(buf as ArrayBuffer);
	for (const ws of wb.worksheets) {
		const header = (ws.getRow(1).values as unknown[]).map((v) =>
			String(v ?? '')
				.toLowerCase()
				.trim()
		);
		const col = (name: string) => header.indexOf(name);
		if (!REQUIRED.every((n) => col(n) > 0)) continue;
		const units = (ws.getRow(2).values as unknown[]).map((v) => String(v ?? ''));
		const scale = units[col('total production')]?.includes('kWh') ? 1000 : 1;
		const out: DailyTotals[] = [];
		ws.eachRow((row, i) => {
			if (i <= 2) return;
			const date = toIsoDate(row.getCell(1).value);
			if (!date) return;
			const num = (name: string) => Number(row.getCell(col(name)).value ?? 0) * scale;
			out.push({
				date,
				pvWh: num('total production'),
				importWh: num('energy from grid'),
				exportWh: num('energy to grid')
			});
		});
		return out;
	}
	throw new Error(
		'No "Energy balance" sheet found. In Solar.web, export the energy balance with production, energy to grid and energy from grid.'
	);
}

export function storeDaily(rows: DailyTotals[], db = getDb()): number {
	const stmt = db.prepare(
		`INSERT INTO daily_import (date, pv_wh, import_wh, export_wh, source) VALUES (?, ?, ?, ?, 'solarweb')
		 ON CONFLICT(date) DO UPDATE SET pv_wh = excluded.pv_wh, import_wh = excluded.import_wh,
		   export_wh = excluded.export_wh`
	);
	db.transaction(() => {
		for (const r of rows) stmt.run(r.date, r.pvWh, r.importWh, r.exportWh);
	})();
	return rows.length;
}
