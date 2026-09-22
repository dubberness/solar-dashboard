<script lang="ts">
	import { onMount } from 'svelte';
	import { echarts, onSchemeChange, themeColors } from '$lib/charts';

	export interface StackSeries {
		name: string;
		colorVar: 'solar' | 'use' | 'peak' | 'export';
		values: number[];
	}

	let {
		labels,
		stacks,
		unit = 'kWh',
		ariaLabel
	}: { labels: string[]; stacks: StackSeries[]; unit?: string; ariaLabel: string } = $props();

	let el: HTMLDivElement;
	let chart: echarts.ECharts | null = null;

	function render() {
		if (!chart) return;
		const c = themeColors();
		const fmt = (v: number) => `${v.toFixed(v >= 100 ? 0 : 1)} ${unit}`;
		chart.setOption(
			{
				animation: false,
				grid: { left: 48, right: 8, top: 12, bottom: 28 },
				xAxis: {
					type: 'category',
					data: labels,
					axisLine: { lineStyle: { color: c.grid } },
					axisTick: { show: false },
					axisLabel: { color: c.muted, fontSize: 12 }
				},
				yAxis: {
					type: 'value',
					axisLabel: { color: c.muted, fontSize: 12 },
					splitLine: { lineStyle: { color: c.grid, width: 1 } },
					splitNumber: 4
				},
				tooltip: {
					trigger: 'axis',
					axisPointer: { type: 'shadow', shadowStyle: { color: c.peakBand } },
					backgroundColor: c.surface,
					borderColor: c.border,
					textStyle: { color: c.text, fontSize: 14 },
					formatter: (items: any[]) => {
						const total = items.reduce((s, i) => s + (i.value ?? 0), 0);
						const rows = [...items]
							.reverse()
							.map(
								(i) =>
									`<div style="display:flex;gap:8px;align-items:center"><span style="width:10px;height:10px;background:${i.color};border-radius:2px"></span>${i.seriesName}<b style="margin-left:auto;padding-left:12px">${fmt(i.value ?? 0)}</b></div>`
							)
							.join('');
						return `<div style="font-weight:600;margin-bottom:4px">${items[0].name} · ${fmt(total)}</div>${rows}`;
					}
				},
				series: stacks.map((s, idx) => ({
					name: s.name,
					type: 'bar',
					stack: 'total',
					barMaxWidth: 24,
					itemStyle: {
						color: c[s.colorVar],
						borderColor: c.surface,
						borderWidth: 1,
						// Round only the top of the stack; square at the baseline.
						borderRadius: idx === stacks.length - 1 ? [4, 4, 0, 0] : 0
					},
					emphasis: { disabled: true },
					data: s.values
				}))
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
		void [labels, stacks];
		render();
	});
</script>

<div bind:this={el} class="h-64 w-full" role="img" aria-label={ariaLabel}></div>
