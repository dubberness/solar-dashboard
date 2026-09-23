<script lang="ts">
	import { onMount } from 'svelte';
	import ApplianceCard from '$lib/components/ApplianceCard.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import RealtimeChart from '$lib/components/RealtimeChart.svelte';
	import TodayChart from '$lib/components/TodayChart.svelte';
	import { HOBART_TZ } from '$lib/tou';
	import type { RealtimePoint, Snapshot } from '$lib/types';

	const RECENT_MS = 30 * 60_000;

	let { data } = $props();

	// svelte-ignore state_referenced_locally
	let snap: Snapshot = $state(data.snapshot);
	interface Today {
		dayStart: number;
		series: Array<{ ts: number; pvKw: number; useKw: number; carKw?: number }>;
		forecast: Array<{ ts: number; pvKw: number }>;
	}
	let today = $state<Today | null>(null);
	let clock = $state(Date.now());
	let recent: RealtimePoint[] = $state([]);
	const carInRecent = $derived(recent.some((p) => p.carKw > 0.1));
	const carToday = $derived(today?.series.some((p) => (p.carKw ?? 0) > 0.1) ?? false);

	const kw = (v: number) => `${Math.max(0, v).toFixed(1)} kW`;
	const n = (v: number) => Math.max(0, v).toFixed(1);

	// "Using" is everything on the meter, split into house and car when the car is
	// charging. "Spare" counts the part of the car's charging that evcc would give up.
	const stats = $derived.by(() => {
		const live = snap.live;
		const car = live?.car ?? null;
		return [
			{ label: 'Making', icon: 'sun', value: live?.pvKw ?? null, sub: null },
			{
				label: 'Using',
				icon: 'home',
				value: live ? live.loadKw + (car?.kw ?? 0) : null,
				sub: live && car ? `House ${n(live.loadKw)} + car ${n(car.kw)}` : null
			},
			{
				label: 'Spare',
				icon: 'spare',
				value: live?.spareKw ?? null,
				sub:
					car?.mode === 'pv'
						? 'The car will make room'
						: car?.mode === 'minpv'
							? 'The car will slow down'
							: null
			}
		] as const;
	});
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

	async function loadRecent() {
		try {
			const res = await fetch('/api/recent');
			if (res.ok) recent = await res.json();
		} catch {
			// keep what we have
		}
	}

	function addLive(s: Snapshot) {
		if (!s.live || s.stale) return;
		const last = recent.at(-1);
		if (last && s.now <= last.ts) return;
		const point = {
			ts: s.now,
			pvKw: s.live.pvKw,
			useKw: s.live.loadKw,
			carKw: s.live.car?.kw ?? 0
		};
		recent = [...recent.filter((p) => p.ts >= s.now - RECENT_MS), point];
	}

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
				addLive(snap);
			};
		};
		const disconnect = () => {
			es?.close();
			es = null;
		};
		// Only stream while someone is looking; iPads suspend background tabs anyway.
		const onVisible = () => {
			if (document.visibilityState === 'visible') {
				// Catch up on what happened while the screen was off, then stream.
				loadRecent().then(connect);
				loadToday();
			} else {
				disconnect();
			}
		};
		loadRecent().then(connect);
		loadToday();
		document.addEventListener('visibilitychange', onVisible);
		const chartTimer = setInterval(
			() => document.visibilityState === 'visible' && loadToday(),
			60_000
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
		{#each stats as stat (stat.label)}
			<div class="rounded-2xl bg-[var(--surface-2)] px-4 py-3 sm:px-5 sm:py-4">
				<div class="flex items-center gap-1.5 text-base text-[var(--text-secondary)] sm:text-lg">
					<Icon name={stat.icon as 'sun'} size={20} />{stat.label}
				</div>
				<div class="tabular text-2xl font-semibold whitespace-nowrap sm:text-4xl">
					{stat.value == null ? '–' : kw(stat.value)}
				</div>
				{#if stat.sub}
					<div class="mt-0.5 text-sm leading-snug text-[var(--text-secondary)] sm:text-base">
						{stat.sub}
					</div>
				{/if}
			</div>
		{/each}
	</div>

	{#if snap.live?.car}
		<p class="-mt-2 px-1 text-base text-[var(--text-secondary)] sm:text-lg">
			{#if snap.live.car.mode === 'pv'}
				The car is charging on spare sunshine ({kw(snap.live.car.kw)}). It slows down when you turn
				something on.
			{:else if snap.live.car.mode === 'minpv'}
				The car is charging ({kw(snap.live.car.kw)}). It slows down when you turn something on, but
				keeps charging a little.
			{:else if snap.live.car.mode === 'plan'}
				The car is charging to a schedule ({kw(snap.live.car.kw)}). It won’t slow down for the
				washer or dryer.
			{:else}
				The car is on fast charge ({kw(snap.live.car.kw)}). It won’t slow down for the washer or
				dryer.
			{/if}
		</p>
	{/if}

	<section class="rounded-2xl bg-[var(--surface-2)] px-3 pt-4 pb-2 sm:px-5">
		<div class="flex flex-wrap items-baseline justify-between gap-2 px-1">
			<h2 class="text-lg font-medium">Last 30 minutes</h2>
			<div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--text-secondary)] sm:text-base">
				<span class="flex items-center gap-1.5"
					><span class="h-[3px] w-4 rounded bg-[var(--series-solar)]"></span>Solar</span
				>
				<span class="flex items-center gap-1.5"
					><span class="swatch bg-[var(--series-use)]"></span>House using</span
				>
				{#if carInRecent}
					<span class="flex items-center gap-1.5"
						><span class="swatch bg-[var(--series-car)]"></span>Car charging</span
					>
				{/if}
			</div>
		</div>
		<RealtimeChart points={recent} now={clock} windowMs={RECENT_MS} />
	</section>

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
					><span class="swatch bg-[var(--series-use)]"></span>House using</span
				>
				{#if carToday}
					<span class="flex items-center gap-1.5"
						><span class="swatch bg-[var(--series-car)]"></span>Car charging</span
					>
				{/if}
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

<style>
	/* Legend key for a filled area, matching its translucent fill. */
	.swatch {
		width: 1rem;
		height: 0.75rem;
		border-radius: 2px;
		opacity: 0.5;
	}
</style>
