<script lang="ts">
	import HistoryChart from '$lib/components/HistoryChart.svelte';
	import TodayChart from '$lib/components/TodayChart.svelte';

	let { data } = $props();

	const r = $derived(data.result);
	const t = $derived(r.totals);
	const ly = $derived(r.lastYear);
	let showTable = $state(false);

	const periods = [
		['day', 'Day'],
		['week', 'Week'],
		['month', 'Month'],
		['year', 'Year']
	] as const;

	const n = (v: number, dp = 1) =>
		v.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });
	/** Big energy totals lose the decimal so tiles don't wrap. */
	const e = (v: number) => `${n(v, Math.abs(v) >= 100 ? 0 : 1)} kWh`;
	const money = (v: number) =>
		v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
	const dayMonth = (d: string) =>
		new Date(`${d}T00:00:00Z`).toLocaleDateString('en-AU', {
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC'
		});
	const comparedWith = $derived.by(() => {
		if (r.lastYearTo >= r.to) return `the same ${data.period}`;
		const last = new Date(Date.parse(`${r.lastYearTo}T00:00:00Z`) - 86_400_000)
			.toISOString()
			.slice(0, 10);
		return `${dayMonth(r.from)} to ${dayMonth(last)}`;
	});
	const href = (period: string, date: string) => `/history?period=${period}&date=${date}`;

	/** Change vs last year, as text. Returns null when last year has no data. */
	function delta(now: number, before: number, unit: string, lowerIsBetter: boolean) {
		if (!ly.days) return null;
		const diff = now - before;
		if (Math.abs(diff) < 0.05) return { text: `Same as last year`, good: null };
		const better = lowerIsBetter ? diff < 0 : diff > 0;
		const arrow = diff > 0 ? '▲' : '▼';
		return {
			text: `${arrow} ${unit === '$' ? money(Math.abs(diff)) : `${n(Math.abs(diff), unit === '%' ? 0 : 1)} ${unit}`} vs last year`,
			good: better
		};
	}

	const tiles = $derived([
		{
			label: 'Peak grid power',
			value: e(t.importPeakKwh),
			delta: delta(t.importPeakKwh, ly.importPeakKwh, 'kWh', true),
			hint: 'The expensive power. Lower is better.'
		},
		{
			label: 'Peak power covered by solar',
			value: e(t.selfPeakKwh),
			delta: delta(t.selfPeakKwh, ly.selfPeakKwh, 'kWh', false),
			hint: 'Solar used during peak times'
		},
		{
			label: 'Solar generated',
			value: e(t.pvKwh),
			delta: delta(t.pvKwh, ly.pvKwh, 'kWh', false),
			hint: `${e(t.exportKwh)} sent to the grid`
		},
		{
			label: 'Solar used at home',
			value: t.selfConsumptionPct === null ? '–' : `${n(t.selfConsumptionPct, 0)}%`,
			delta:
				t.selfConsumptionPct === null || ly.selfConsumptionPct === null
					? null
					: delta(t.selfConsumptionPct, ly.selfConsumptionPct, '%', false),
			hint: 'Share of solar used rather than sold'
		},
		{
			label: 'Solar value',
			value: money(t.solarValueDollars),
			delta: delta(t.solarValueDollars, ly.solarValueDollars, '$', false),
			hint: 'Grid power avoided plus feed-in credit'
		}
	]);

	const labels = $derived(r.buckets.map((b) => b.label));
	const sources = $derived([
		{
			name: 'Solar',
			colorVar: 'solar' as const,
			values: r.buckets.map((b) => b.selfPeakKwh + b.selfOffKwh)
		},
		{
			name: 'Off-peak grid',
			colorVar: 'use' as const,
			values: r.buckets.map((b) => b.importOffKwh)
		},
		{ name: 'Peak grid', colorVar: 'peak' as const, values: r.buckets.map((b) => b.importPeakKwh) }
	]);
	const solarUse = $derived([
		{
			name: 'Used at home',
			colorVar: 'solar' as const,
			values: r.buckets.map((b) => b.selfPeakKwh + b.selfOffKwh)
		},
		{ name: 'Sent to grid', colorVar: 'export' as const, values: r.buckets.map((b) => b.exportKwh) }
	]);
</script>

<svelte:head><title>History · Solar</title></svelte:head>

<main
	class="mx-auto flex max-w-6xl flex-col gap-5 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-10 sm:px-8"
>
	<header class="flex flex-wrap items-center justify-between gap-3">
		<a href="/" class="text-[var(--text-secondary)]">← Now</a>
		<nav class="flex rounded-full bg-[var(--surface-2)] p-1" aria-label="Period">
			{#each periods as [p, label] (p)}
				<a
					href={href(p, data.date)}
					class="rounded-full px-4 py-1.5 text-sm font-medium sm:text-base"
					class:bg-[var(--text-primary)]={data.period === p}
					class:text-[var(--surface-1)]={data.period === p}
					aria-current={data.period === p ? 'page' : undefined}>{label}</a
				>
			{/each}
		</nav>
	</header>

	<div class="flex items-center justify-between gap-3">
		<a
			href={href(data.period, data.prev)}
			class="rounded-full px-3 py-1 text-2xl text-[var(--text-secondary)]"
			class:invisible={!data.hasOlder}
			aria-label="Previous">‹</a
		>
		<h1 class="text-center text-2xl font-semibold sm:text-3xl">{r.label}</h1>
		<a
			href={data.next ? href(data.period, data.next) : undefined}
			class="rounded-full px-3 py-1 text-2xl text-[var(--text-secondary)]"
			class:invisible={!data.next}
			aria-label="Next">›</a
		>
	</div>

	{#if t.days === 0}
		<p class="rounded-2xl bg-[var(--surface-2)] p-6 text-center text-[var(--text-secondary)]">
			No data for this {data.period}. Older history can be added from a Solar.web export in
			Settings.
		</p>
	{:else}
		<div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
			{#each tiles as tile, i (tile.label)}
				<div
					class="rounded-2xl bg-[var(--surface-2)] px-4 py-3"
					class:col-span-2={i === 0}
					class:lg:col-span-1={i === 0}
				>
					<div class="text-sm text-[var(--text-secondary)]">{tile.label}</div>
					<div class="text-2xl font-semibold tracking-tight whitespace-nowrap xl:text-3xl">
						{tile.value}
					</div>
					{#if tile.delta}
						<div
							class="text-sm"
							style:color={tile.delta.good === null
								? 'var(--text-secondary)'
								: tile.delta.good
									? 'var(--go-icon)'
									: 'var(--wait-icon)'}
						>
							{tile.delta.text}
						</div>
					{/if}
					<div class="mt-0.5 text-xs text-[var(--text-muted)]">{tile.hint}</div>
				</div>
			{/each}
		</div>

		{#if data.period === 'day' && r.series && data.dayStart}
			<section class="rounded-2xl bg-[var(--surface-2)] px-3 pt-4 pb-2 sm:px-5">
				<div class="flex flex-wrap items-baseline justify-between gap-2 px-1">
					<h2 class="text-lg font-medium">Solar and house usage</h2>
					<div class="flex gap-4 text-sm text-[var(--text-secondary)]">
						<span class="flex items-center gap-1.5"
							><span class="h-[3px] w-4 rounded bg-[var(--series-solar)]"></span>Solar</span
						>
						<span class="flex items-center gap-1.5"
							><span class="h-[3px] w-4 rounded bg-[var(--series-use)]"></span>House using</span
						>
						<span class="flex items-center gap-1.5"
							><span class="h-3 w-4 rounded-sm bg-[var(--peak-band)] ring-1 ring-[var(--border)]"
							></span>Peak price</span
						>
					</div>
				</div>
				<TodayChart series={r.series} forecast={[]} dayStart={data.dayStart} now={Date.now()} />
			</section>
		{:else}
			<div class="grid gap-4 lg:grid-cols-2">
				{#each [{ title: 'Where the house’s power came from', stacks: sources }, { title: 'Where the solar went', stacks: solarUse }] as chart (chart.title)}
					<section class="rounded-2xl bg-[var(--surface-2)] px-3 pt-4 pb-2 sm:px-5">
						<div class="flex flex-wrap items-baseline justify-between gap-2 px-1">
							<h2 class="text-lg font-medium">{chart.title}</h2>
							<div class="flex flex-wrap gap-x-4 text-sm text-[var(--text-secondary)]">
								{#each chart.stacks as s (s.name)}
									<span class="flex items-center gap-1.5">
										<span
											class="h-2.5 w-2.5 rounded-sm"
											style:background="var(--series-{s.colorVar})"
										></span>{s.name}
									</span>
								{/each}
							</div>
						</div>
						<HistoryChart {labels} stacks={chart.stacks} ariaLabel={chart.title} />
					</section>
				{/each}
			</div>
		{/if}

		<div class="flex flex-wrap items-start justify-between gap-3 text-sm text-[var(--text-muted)]">
			<div class="flex flex-col gap-1">
				<span
					>Usage covers the general circuit only. Heating and hot water aren’t measured, but they
					never run at peak.</span
				>
				{#if t.estimated}
					<span
						>≈ Some days come from Solar.web daily totals. Their peak/off-peak split is estimated
						from similar months.</span
					>
				{/if}
				{#if ly.days}
					<span>Compared with {comparedWith} last year.</span>
				{/if}
			</div>
			{#if data.period !== 'day'}
				<button class="underline" onclick={() => (showTable = !showTable)}>
					{showTable ? 'Hide table' : 'Show table'}
				</button>
			{/if}
		</div>

		{#if showTable && data.period !== 'day'}
			<div class="overflow-x-auto rounded-2xl bg-[var(--surface-2)]">
				<table class="tabular w-full text-right text-sm">
					<thead class="text-[var(--text-secondary)]">
						<tr>
							<th class="px-3 py-2 text-left font-medium"
								>{data.period === 'year' ? 'Month' : 'Day'}</th
							>
							<th class="px-3 py-2 font-medium">Solar</th>
							<th class="px-3 py-2 font-medium">Used</th>
							<th class="px-3 py-2 font-medium">Peak grid</th>
							<th class="px-3 py-2 font-medium">Off-peak grid</th>
							<th class="px-3 py-2 font-medium">Peak solar</th>
							<th class="px-3 py-2 font-medium">Exported</th>
						</tr>
					</thead>
					<tbody>
						{#each r.buckets as b (b.date)}
							<tr class="border-t border-[var(--border)]">
								<td class="px-3 py-1.5 text-left"
									>{data.period === 'year' ? b.label : b.date}{b.estimated ? ' ≈' : ''}</td
								>
								{#if b.source === 'none'}
									<td class="px-3 py-1.5 text-[var(--text-muted)]" colspan="6">No data</td>
								{:else}
									<td class="px-3 py-1.5">{n(b.pvKwh)}</td>
									<td class="px-3 py-1.5">{n(b.useKwh)}</td>
									<td class="px-3 py-1.5">{n(b.importPeakKwh)}</td>
									<td class="px-3 py-1.5">{n(b.importOffKwh)}</td>
									<td class="px-3 py-1.5">{n(b.selfPeakKwh)}</td>
									<td class="px-3 py-1.5">{n(b.exportKwh)}</td>
								{/if}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</main>
