<script lang="ts">
	import { onMount } from 'svelte';
	import ApplianceCard from '$lib/components/ApplianceCard.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import TodayChart from '$lib/components/TodayChart.svelte';
	import { HOBART_TZ } from '$lib/tou';
	import type { Snapshot } from '$lib/types';

	let { data } = $props();

	// svelte-ignore state_referenced_locally
	let snap: Snapshot = $state(data.snapshot);
	let today: {
		dayStart: number;
		series: Array<{ ts: number; pvKw: number; useKw: number }>;
		forecast: Array<{ ts: number; pvKw: number }>;
	} | null = $state(null);
	let clock = $state(Date.now());

	const kw = (v: number) => `${Math.max(0, v).toFixed(1)} kW`;
	const dateText = $derived(
		new Intl.DateTimeFormat('en-AU', {
			timeZone: HOBART_TZ,
			weekday: 'long',
			hour: 'numeric',
			minute: '2-digit'
		})
			.format(clock)
			.replace(/\s(am|pm)/i, '$1')
			.toLowerCase()
			.replace(/^\w/, (c) => c.toUpperCase())
	);

	async function loadToday() {
		try {
			const res = await fetch('/api/today');
			if (res.ok) today = await res.json();
		} catch {
			// keep the last chart
		}
	}

	onMount(() => {
		let es: EventSource | null = null;
		const connect = () => {
			es?.close();
			es = new EventSource('/api/stream');
			es.onmessage = (e) => {
				snap = JSON.parse(e.data);
				clock = Date.now();
			};
		};
		const disconnect = () => {
			es?.close();
			es = null;
		};
		// Only stream while someone is looking; iPads suspend background tabs anyway.
		const onVisible = () => {
			if (document.visibilityState === 'visible') {
				connect();
				loadToday();
			} else {
				disconnect();
			}
		};
		connect();
		loadToday();
		document.addEventListener('visibilitychange', onVisible);
		const chartTimer = setInterval(
			() => document.visibilityState === 'visible' && loadToday(),
			5 * 60_000
		);
		const clockTimer = setInterval(() => (clock = Date.now()), 30_000);
		return () => {
			disconnect();
			document.removeEventListener('visibilitychange', onVisible);
			clearInterval(chartTimer);
			clearInterval(clockTimer);
		};
	});
</script>

<main
	class="mx-auto flex min-h-dvh max-w-5xl flex-col gap-5 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-8 sm:px-8"
>
	<header class="flex flex-wrap items-center justify-between gap-3">
		<div class="text-xl text-[var(--text-secondary)] sm:text-2xl">{dateText}</div>
		<div
			class="rounded-full border px-4 py-1.5 text-lg font-medium sm:text-xl"
			style:background={snap.period.isPeak ? 'var(--okay-bg)' : 'var(--go-bg)'}
			style:border-color={snap.period.isPeak ? 'var(--okay-border)' : 'var(--go-border)'}
			style:color={snap.period.isPeak ? 'var(--okay-text)' : 'var(--go-text)'}
		>
			{snap.period.label}
		</div>
	</header>

	<div class="grid gap-4 md:grid-cols-2">
		{#each snap.cards as card (card.applianceId)}
			<ApplianceCard {card} />
		{/each}
	</div>

	<div class="grid grid-cols-3 gap-3">
		{#each [{ label: 'Making', icon: 'sun', value: snap.live?.pvKw }, { label: 'Using', icon: 'home', value: snap.live?.loadKw }, { label: 'Spare', icon: 'spare', value: snap.live?.spareKw }] as stat (stat.label)}
			<div class="rounded-2xl bg-[var(--surface-2)] px-4 py-3 sm:px-5 sm:py-4">
				<div class="flex items-center gap-1.5 text-base text-[var(--text-secondary)] sm:text-lg">
					<Icon name={stat.icon as 'sun'} size={20} />{stat.label}
				</div>
				<div class="tabular text-2xl font-semibold whitespace-nowrap sm:text-4xl">
					{stat.value == null ? '–' : kw(stat.value)}
				</div>
			</div>
		{/each}
	</div>

	<section class="rounded-2xl bg-[var(--surface-2)] px-3 pt-4 pb-2 sm:px-5">
		<div class="flex flex-wrap items-baseline justify-between gap-2 px-1">
			<h2 class="text-lg font-medium">Today</h2>
			<div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--text-secondary)] sm:text-base">
				<span class="flex items-center gap-1.5"
					><span class="h-[3px] w-4 rounded bg-[var(--series-solar)]"></span>Solar</span
				>
				<span class="flex items-center gap-1.5"
					><span class="w-4 border-t-2 border-dotted border-[var(--series-solar)]"
					></span>Forecast</span
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
		{#if today}
			<TodayChart
				series={today.series}
				forecast={today.forecast}
				dayStart={today.dayStart}
				now={clock}
			/>
		{:else}
			<div class="h-[clamp(14rem,30vh,24rem)]"></div>
		{/if}
	</section>

	<footer class="mt-auto flex items-center justify-between text-sm text-[var(--text-muted)]">
		<span>
			{#if snap.stale}Waiting for the inverter…{:else if !snap.forecastAvailable}Forecast
				unavailable, using live readings{/if}
		</span>
		<nav class="flex gap-5">
			<a href="/history" class="py-2">History</a>
			<a href="/settings" class="py-2">Settings</a>
		</nav>
	</footer>
</main>
