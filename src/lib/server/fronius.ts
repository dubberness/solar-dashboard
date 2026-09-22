// Fronius Solar API v1 (Datamanager / Primo). Plain HTTP, no auth.
import { isPeak } from '$lib/tou';
import type { LiveReading } from '$lib/types';

const TIMEOUT_MS = 4000;

async function getJson(url: string, timeout = TIMEOUT_MS): Promise<any> {
	const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
	if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
	const body = await res.json();
	const code = body?.Head?.Status?.Code;
	if (code !== 0) throw new Error(`Fronius status ${code}: ${body?.Head?.Status?.Reason}`);
	return body;
}

export function parsePowerFlow(body: any): { pvW: number; gridW: number; loadW: number } {
	const site = body.Body.Data.Site;
	const pvW = site.P_PV ?? 0; // null at night
	const gridW = site.P_Grid ?? 0;
	// P_Load is reported negative (consumption); derive it so the three always balance.
	const loadW = Math.max(0, pvW + gridW);
	return { pvW, gridW, loadW };
}

export function parseMeter(body: any): { importWh: number; exportWh: number } | null {
	const meter = body?.Body?.Data?.['0'] ?? Object.values(body?.Body?.Data ?? {})[0];
	if (!meter) return null;
	return {
		importWh: meter.EnergyReal_WAC_Plus_Absolute,
		exportWh: meter.EnergyReal_WAC_Minus_Absolute
	};
}

export async function readLive(host: string): Promise<LiveReading> {
	const [flow, meter] = await Promise.all([
		getJson(`http://${host}/solar_api/v1/GetPowerFlowRealtimeData.fcgi`),
		getJson(`http://${host}/solar_api/v1/GetMeterRealtimeData.cgi?Scope=System`).catch(() => null)
	]);
	const counters = meter ? parseMeter(meter) : null;
	return {
		ts: Date.now(),
		...parsePowerFlow(flow),
		importWh: counters?.importWh ?? null,
		exportWh: counters?.exportWh ?? null
	};
}

export interface ArchiveInterval {
	ts: number; // start, epoch ms
	pvWh: number;
	importWh: number;
	exportWh: number;
	isPeak: boolean;
}

/** YYYY-MM-DD to the D.M.YYYY form the archive API wants (inverter local dates). */
const fmtDate = (date: string) => {
	const [y, m, d] = date.split('-').map(Number);
	return `${d}.${m}.${y}`;
};

/**
 * Parse a GetArchiveData response into 5-minute intervals. Inverter values
 * are the energy of the period ending at their timestamp; meter values are
 * lifetime counters read at their timestamp.
 */
export function parseArchive(body: any): ArchiveInterval[] {
	const data = body?.Body?.Data ?? {};
	const pv = new Map<number, number>();
	let imp = new Map<number, number>();
	let exp = new Map<number, number>();
	for (const [key, dev] of Object.entries<any>(data)) {
		const start = Date.parse(dev.Start);
		const at = (offset: string) => start + Number(offset) * 1000;
		const ch = dev.Data ?? {};
		if (key.startsWith('inverter')) {
			for (const [o, v] of Object.entries<number>(ch.EnergyReal_WAC_Sum_Produced?.Values ?? {}))
				pv.set(at(o), (pv.get(at(o)) ?? 0) + v);
		} else if (key.startsWith('meter')) {
			imp = new Map(
				Object.entries<number>(ch.EnergyReal_WAC_Plus_Absolute?.Values ?? {}).map(([o, v]) => [
					at(o),
					v
				])
			);
			exp = new Map(
				Object.entries<number>(ch.EnergyReal_WAC_Minus_Absolute?.Values ?? {}).map(([o, v]) => [
					at(o),
					v
				])
			);
		}
	}
	const out: ArchiveInterval[] = [];
	const step = 300_000;
	for (const end of [...imp.keys()].sort((a, b) => a - b)) {
		const start = end - step;
		const i0 = imp.get(start);
		const e0 = exp.get(start);
		const e1 = exp.get(end);
		if (i0 === undefined || e0 === undefined || e1 === undefined) continue;
		const importWh = imp.get(end)! - i0;
		const exportWh = e1 - e0;
		// Counter resets or glitches: skip rather than record nonsense.
		if (importWh < 0 || exportWh < 0 || importWh > 10_000 || exportWh > 10_000) continue;
		out.push({
			ts: start,
			pvWh: pv.get(end) ?? 0,
			importWh,
			exportWh,
			isPeak: isPeak(start + step / 2)
		});
	}
	return out;
}

/** Fetch archive intervals for local dates [from, to] inclusive (keep ranges to about a week). */
export async function readArchive(
	host: string,
	from: string,
	to: string
): Promise<ArchiveInterval[]> {
	const channels = [
		'EnergyReal_WAC_Sum_Produced',
		'EnergyReal_WAC_Plus_Absolute',
		'EnergyReal_WAC_Minus_Absolute'
	]
		.map((c) => `&Channel=${c}`)
		.join('');
	const url = `http://${host}/solar_api/v1/GetArchiveData.cgi?Scope=System&StartDate=${fmtDate(from)}&EndDate=${fmtDate(to)}${channels}`;
	return parseArchive(await getJson(url, 60_000));
}
