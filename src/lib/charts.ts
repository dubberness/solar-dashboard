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
