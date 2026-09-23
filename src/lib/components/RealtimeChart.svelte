<script lang="ts">
	import { onMount } from 'svelte';
	import {
		echarts,
		hobartTime,
		onSchemeChange,
		themeColors,
		usageSeries,
		usageTooltip
	} from '$lib/charts';
	import type { RealtimePoint } from '$lib/types';

	let { points, now, windowMs }: { points: RealtimePoint[]; now: number; windowMs: number } =
		$props();

	let el: HTMLDivElement;
	let chart: echarts.ECharts | null = null;

	const showCar = $derived(points.some((p) => p.carKw > 0.1));

	function render() {
		if (!chart) return;
		const c = themeColors();
		chart.setOption(
			{
				animation: false,
				grid: { left: 44, right: 12, top: 12, bottom: 28 },
				xAxis: {
					type: 'time',
					min: now - windowMs,
					max: now,
					splitNumber: 3,
					axisLine: { lineStyle: { color: c.grid } },
					axisTick: { show: false },
					axisLabel: { color: c.muted, fontSize: 13, formatter: (v: number) => hobartTime(v) },
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
					axisPointer: { type: 'line', lineStyle: { color: c.muted } },
					formatter: usageTooltip
				},
				series: usageSeries(c, points, showCar, false)
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
		void [points, now, showCar];
		render();
	});
</script>

<div
	bind:this={el}
	class="h-[clamp(11rem,22vh,18rem)] w-full"
	role="img"
	aria-label="Solar and house use over the last 30 minutes"
></div>
