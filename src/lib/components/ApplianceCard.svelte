<script lang="ts">
	import type { CardVerdict } from '$lib/types';
	import Icon from './Icon.svelte';

	let { card }: { card: CardVerdict } = $props();

	const stateIcon = { go: 'check', okay: 'clock', wait: 'hand', nodata: 'dash' } as const;
</script>

<section
	class="card flex min-h-[220px] flex-col gap-3 rounded-3xl border p-6 transition-colors duration-700 sm:p-8"
	style:--bg="var(--{card.state}-bg)"
	style:--bd="var(--{card.state}-border)"
	style:--fg="var(--{card.state}-text)"
	style:--ic="var(--{card.state}-icon)"
	aria-live="polite"
>
	<div class="flex items-center gap-3 text-xl font-medium sm:text-2xl">
		<span style:color="var(--ic)"><Icon name={card.icon} size={34} /></span>
		{card.name}
	</div>
	<div class="flex items-center gap-3">
		<span style:color="var(--ic)"><Icon name={stateIcon[card.state]} size={52} /></span>
		<span class="text-5xl font-semibold tracking-tight sm:text-6xl">{card.headline}</span>
	</div>
	<p class="text-lg leading-snug sm:text-xl">{card.detail}</p>
</section>

<style>
	.card {
		background: var(--bg);
		border-color: var(--bd);
		color: var(--fg);
	}
</style>
