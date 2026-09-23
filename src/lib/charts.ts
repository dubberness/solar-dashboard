import { BarChart, LineChart } from 'echarts/charts';
import {
	GridComponent,
	MarkAreaComponent,
	MarkLineComponent,
	TooltipComponent
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { HOBART_TZ, isPeak } from './tou';

echarts.use([
	LineChart,
	BarChart,
	GridComponent,
	TooltipComponent,
	MarkAreaComponent,
	MarkLineComponent,
	SVGRenderer
]);

export { echarts };

/** ECharts can't read CSS variables, so resolve the theme tokens it needs. */
export function themeColors() {
	const s = getComputedStyle(document.documentElement);
	const v = (n: string) => s.getPropertyValue(n).trim();
	return {
		solar: v('--series-solar'),
		use: v('--series-use'),
		peak: v('--series-peak'),
		export: v('--series-export'),
		car: v('--series-car'),
		text: v('--text-primary'),
		textSecondary: v('--text-secondary'),
		muted: v('--text-muted'),
		grid: v('--grid'),
		peakBand: v('--peak-band'),
		surface: v('--surface-2'),
		border: v('--border')
	};
}

/** Re-run a callback when the OS switches light/dark. Returns a cleanup. */
export function onSchemeChange(fn: () => void): () => void {
	const mq = matchMedia('(prefers-color-scheme: dark)');
	mq.addEventListener('change', fn);
	return () => mq.removeEventListener('change', fn);
}

/** Peak periods in [from, to) as [start, end] pairs, for shading. */
export function peakRanges(from: number, to: number): Array<[number, number]> {
	const step = 5 * 60_000;
	const out: Array<[number, number]> = [];
	let start: number | null = null;
	for (let t = from; t <= to; t += step) {
		const p = t < to && isPeak(t + step / 2);
		if (p && start === null) start = t;
		if (!p && start !== null) {
			out.push([start, t]);
			start = null;
		}
	}
	return out;
}

export const hobartTime = (ts: number) =>
	new Intl.DateTimeFormat('en-AU', { timeZone: HOBART_TZ, hour: 'numeric', minute: '2-digit' })
		.format(ts)
		.replace(/\s/g, '')
		.toLowerCase();

export const hobartHour = (ts: number) =>
	new Intl.DateTimeFormat('en-AU', { timeZone: HOBART_TZ, hour: 'numeric' })
		.format(ts)
		.replace(/\s/g, '')
		.toLowerCase();

type Colors = ReturnType<typeof themeColors>;
type Pt = { ts: number; pvKw: number; useKw: number; carKw?: number };

/**
 * House use and car charging stacked as filled areas, so the top edge is the
 * total, with solar as a line over them: where the stack rises above the
 * line, the difference comes from the grid.
 */
export function usageSeries(c: Colors, points: Pt[], showCar: boolean, smooth: number | false) {
	const area = (name: string, color: string, data: Array<[number, number | null]>) => ({
		name,
		type: 'line',
		stack: 'use',
		smooth,
		showSymbol: false,
		lineStyle: { width: 1.5, color, join: 'round' },
		itemStyle: { color },
		areaStyle: { color, opacity: 0.35 },
		data
	});
	return [
		area(
			'House using',
			c.use,
			points.map((p) => [p.ts, p.useKw])
		),
		// Gaps rather than zeros while the car isn't charging, so no car edge is drawn over the house.
		...(showCar
			? [
					area(
						'Car charging',
						c.car,
						points.map((p) => [p.ts, (p.carKw ?? 0) > 0.05 ? p.carKw! : null])
					)
				]
			: []),
		{
			name: 'Solar',
			type: 'line',
			smooth,
			showSymbol: false,
			z: 3,
			lineStyle: { width: 2.5, color: c.solar, cap: 'round', join: 'round' },
			itemStyle: { color: c.solar },
			data: points.map((p) => [p.ts, p.pvKw])
		}
	];
}

/** Tooltip body: solar first, then house, car and their total. */
export function usageTooltip(items: any[]): string {
	const order = ['Solar', 'Solar forecast', 'House using', 'Car charging'];
	const shown = items
		.filter((i) => i.value?.[1] != null)
		.sort((a, b) => order.indexOf(a.seriesName) - order.indexOf(b.seriesName));
	const row = (color: string | null, name: string, kw: number, bold = false) =>
		`<div style="display:flex;gap:8px;align-items:center${bold ? ';font-weight:600' : ''}">` +
		(color
			? `<span style="width:10px;height:3px;background:${color};border-radius:2px"></span>`
			: '<span style="width:10px"></span>') +
		`${name}<b style="margin-left:auto;padding-left:12px">${kw.toFixed(1)} kW</b></div>`;
	const rows = shown.map((i) => row(i.color, i.seriesName, i.value[1]));
	const house = shown.find((i) => i.seriesName === 'House using');
	const car = shown.find((i) => i.seriesName === 'Car charging');
	if (house && car && car.value[1] > 0.05)
		rows.push(row(null, 'Total using', house.value[1] + car.value[1], true));
	return `<div style="font-weight:600;margin-bottom:4px">${hobartTime(items[0].value[0])}</div>${rows.join('')}`;
}
