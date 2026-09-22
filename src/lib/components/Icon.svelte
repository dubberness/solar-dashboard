<script lang="ts">
	type Name = 'washer' | 'dryer' | 'check' | 'clock' | 'hand' | 'dash' | 'sun' | 'home' | 'spare';
	let { name, size = 24 }: { name: Name; size?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if name === 'washer'}
		<rect x="4" y="3" width="16" height="18" rx="2.5" />
		<path d="M4 7h16" />
		<circle cx="12" cy="14" r="4.5" />
		<path d="M9.5 14.5c1-.8 2-.8 3 0s2 .8 3 0" />
		<circle cx="7" cy="5" r=".6" fill="currentColor" />
	{:else if name === 'dryer'}
		<rect x="4" y="3" width="16" height="18" rx="2.5" />
		<path d="M4 7h16" />
		<circle cx="12" cy="14" r="4.5" />
		<path d="M10.5 12.5c.8.8-.8 2.2 0 3M13.5 12.5c.8.8-.8 2.2 0 3" />
		<circle cx="7" cy="5" r=".6" fill="currentColor" />
	{:else if name === 'check'}
		<circle cx="12" cy="12" r="9" />
		<path d="m8 12.5 2.8 2.8L16.5 9.5" />
	{:else if name === 'clock'}
		<circle cx="12" cy="12" r="9" />
		<path d="M12 7v5l3 2" />
	{:else if name === 'hand'}
		<circle cx="12" cy="12" r="9" />
		<path d="M8 12h8" />
	{:else if name === 'dash'}
		<circle cx="12" cy="12" r="9" />
		<path d="M9 12h.01M12 12h.01M15 12h.01" />
	{:else if name === 'sun'}
		<circle cx="12" cy="12" r="4" />
		<path
			d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
		/>
	{:else if name === 'home'}
		<path d="M3 11 12 4l9 7" />
		<path d="M5 10v10h14V10" />
	{:else if name === 'spare'}
		<path d="M13 3 5 14h6l-1 7 8-11h-6z" />
	{/if}
</svg>
