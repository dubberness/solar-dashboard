<script lang="ts">
	import { onMount } from 'svelte';
	import {
		echarts,
		hobartHour,
		hobartTime,
		onSchemeChange,
		peakRanges,
		themeColors
	} from '$lib/charts';

	interface Point {
		ts: number;
		pvKw: number;
		useKw: number;
	}
	let {
		series,
		forecast,
		dayStart,
		now
	}: {
		series: Point[];
		forecast: Array<{ ts: number; pvKw: number }>;
		dayStart: number;
		now: number;
	} = $props();

	let el: HTMLDivElement;
	let chart: echarts.ECharts | null = null;

	// Show 5am to 10pm; nights are flat and just waste width.
	const from = $derived(dayStart + 5 * 3600_000);
	const to = $derived(dayStart + 22 * 3600_000);

	function render() {
		if (!chart) return;
		const c = themeColors();
		const bands = peakRanges(from, to);
		const futureForecast = forecast.filter((f) => f.ts >= now - 30 * 60_000);
		chart.setOption(
			{
				animation: false,
				grid: { left: 44, right: 12, top: 24, bottom: 28 },
				xAxis: {
					type: 'time',
					min: from,
					max: to,
					splitNumber: 6,
					axisLine: { lineStyle: { color: c.grid } },
					axisTick: { show: false },
					axisLabel: { color: c.muted, fontSize: 13, formatter: (v: number) => hobartHour(v) },
					splitLine: { show: false }
				},
				yAxis: {
					type: 'value',
					min: 0,
					axisLabel: { color: c.muted, fontSize: 13, formatter: '{value} kW' },
					splitLine: { lineStyle: { color: c.grid, width: 1 } },
					splitNumber: 3
				},
				tooltip: {
					trigger: 'axis',
					backgroundColor: c.surface,
					borderColor: c.border,
					textStyle: { color: c.text, fontSize: 14 },
					valueFormatter: (v: number) => (v == null ? '–' : `${v.toFixed(1)} kW`),
					axisPointer: { type: 'line', lineStyle: { color: c.muted } },
					formatter: (items: any[]) => {
						const t = hobartTime(items[0].value[0]);
						const rows = items
							.filter((i) => i.value[1] != null)
							.map(
								(i) =>
									`<div style="display:flex;gap:8px;align-items:center"><span style="width:10px;height:3px;background:${i.color};border-radius:2px"></span>${i.seriesName}<b style="margin-left:auto;padding-left:12px">${i.value[1].toFixed(1)} kW</b></div>`
							)
							.join('');
						return `<div style="font-weight:600;margin-bottom:4px">${t}</div>${rows}`;
					}
				},
				series: [
					{
						name: 'Solar',
						type: 'line',
						showSymbol: false,
						smooth: 0.2,
						lineStyle: { width: 2, color: c.solar, cap: 'round', join: 'round' },
						itemStyle: { color: c.solar },
						areaStyle: { color: c.solar, opacity: 0.12 },
						data: series.map((p) => [p.ts, p.pvKw]),
						markArea: {
							silent: true,
							itemStyle: { color: c.peakBand },
							label: {
								show: true,
								color: c.muted,
								fontSize: 12,
								position: 'insideTop',
								formatter: 'Peak'
							},
							data: bands.map(([s, e]) => [{ xAxis: s }, { xAxis: e }])
						},
						markLine: {
							silent: true,
							symbol: 'none',
							lineStyle: { color: c.muted, type: 'solid', width: 1 },
							label: { show: true, formatter: 'Now', color: c.muted, fontSize: 12 },
							data: now >= from && now <= to ? [{ xAxis: now }] : []
						}
					},
					{
						name: 'Solar forecast',
						type: 'line',
						showSymbol: false,
						smooth: 0.3,
						lineStyle: { width: 2, color: c.solar, type: [2, 5], cap: 'round' },
						itemStyle: { color: c.solar },
						data: futureForecast.map((p) => [p.ts, p.pvKw])
					},
					{
						name: 'House using',
						type: 'line',
						showSymbol: false,
						smooth: 0.2,
						lineStyle: { width: 2, color: c.use, cap: 'round', join: 'round' },
						itemStyle: { color: c.use },
						data: series.map((p) => [p.ts, p.useKw])
					}
				]
			},
			{ notMerge: true }
		);
	}

	onMount(() => {
		chart = echarts.init(el, undefined, { renderer: 'svg' });
		render();
		const ro = new ResizeObserver(() => chart?.resize());
		ro.observe(el);
		const off = onSchemeChange(render);
		return () => {
			ro.disconnect();
			off();
			chart?.dispose();
		};
	});

	$effect(() => {
		// Re-render whenever the inputs change.
		void [series, forecast, now, from];
		render();
	});
</script>

<div
	bind:this={el}
	class="h-[clamp(14rem,30vh,24rem)] w-full"
	role="img"
	aria-label="Today's solar and house usage"
></div>
