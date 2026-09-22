<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const ago = (ts: number | null) => {
		if (!ts) return 'never';
		const s = Math.round((Date.now() - ts) / 1000);
		if (s < 90) return `${s}s ago`;
		if (s < 5400) return `${Math.round(s / 60)} min ago`;
		if (s < 172800) return `${Math.round(s / 3600)} h ago`;
		return `${Math.round(s / 86400)} days ago`;
	};
	const isLocked = (key: string) => data.unlocked && data.locked.includes(key);
	let busy = $state(false);
	const submit = () => {
		busy = true;
		return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	};
</script>

<svelte:head><title>Settings · Solar</title></svelte:head>

<main
	class="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-12 sm:px-8"
>
	<header class="flex items-center justify-between">
		<a href="/" class="text-[var(--text-secondary)]">← Now</a>
		<h1 class="text-2xl font-semibold">Settings</h1>
		{#if data.unlocked}
			<form method="POST" action="?/lock" use:enhance>
				<button class="text-[var(--text-secondary)]">Lock</button>
			</form>
		{:else}
			<span></span>
		{/if}
	</header>

	{#if form?.error}
		<p
			class="rounded-xl border border-[var(--wait-border)] bg-[var(--wait-bg)] px-4 py-3 text-[var(--wait-text)]"
			role="alert"
		>
			{form.error}
		</p>
	{/if}
	{#if form?.saved}
		<p
			class="rounded-xl border border-[var(--go-border)] bg-[var(--go-bg)] px-4 py-3 text-[var(--go-text)]"
		>
			Saved
		</p>
	{/if}
	{#if form?.imported}
		<p
			class="rounded-xl border border-[var(--go-border)] bg-[var(--go-bg)] px-4 py-3 text-[var(--go-text)]"
		>
			{form.imported}
		</p>
	{/if}
	{#if form?.forecastRefreshed}
		<p
			class="rounded-xl border border-[var(--go-border)] bg-[var(--go-bg)] px-4 py-3 text-[var(--go-text)]"
		>
			Forecast updated
		</p>
	{/if}

	{#if !data.unlocked}
		<form
			method="POST"
			action="?/unlock"
			use:enhance
			class="mx-auto mt-10 flex w-full max-w-xs flex-col gap-3"
		>
			<label for="pin" class="text-center text-lg">Enter the settings PIN</label>
			<input
				id="pin"
				name="pin"
				type="password"
				inputmode="numeric"
				autocomplete="off"
				class="field text-center text-2xl tracking-[0.5em]"
				required
			/>
			<button class="btn-primary">Unlock</button>
		</form>
	{:else}
		<form method="POST" action="?/save" use:enhance={submit} class="flex flex-col gap-6">
			<section class="panel">
				<h2>Appliances</h2>
				<p class="hint">
					A card goes green when spare solar reaches the green threshold. "Typical draw" is only
					used for cost estimates.
				</p>
				{#each data.config.appliances as a (a.id)}
					<fieldset class="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<label class="col-span-2 sm:col-span-1"
							>Name<input class="field" name="{a.id}.name" value={a.name} /></label
						>
						<label
							>Green at (kW)<input
								class="field"
								name="{a.id}.thresholdKw"
								type="number"
								step="0.1"
								value={a.thresholdKw}
							/></label
						>
						<label
							>Typical draw (kW)<input
								class="field"
								name="{a.id}.typicalKw"
								type="number"
								step="0.1"
								value={a.typicalKw}
							/></label
						>
						<label
							>Cycle (hours)<input
								class="field"
								name="{a.id}.cycleHours"
								type="number"
								step="0.25"
								value={a.cycleHours}
							/></label
						>
					</fieldset>
				{/each}
			</section>

			<section class="panel">
				<h2>Electricity rates</h2>
				<p class="hint">Cents per kWh as printed on the bill, excluding GST. Feed-in has no GST.</p>
				<input type="hidden" name="tariffCount" value={data.config.tariffs.length} />
				{#each data.config.tariffs as t, i (t.effectiveFrom + i)}
					<fieldset class="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<label
							>From<input
								class="field"
								name="t{i}.effectiveFrom"
								type="date"
								value={t.effectiveFrom}
							/></label
						>
						<label
							>Peak (c)<input
								class="field"
								name="t{i}.peakCents"
								type="number"
								step="0.001"
								value={t.peakCents}
							/></label
						>
						<label
							>Off-peak (c)<input
								class="field"
								name="t{i}.offPeakCents"
								type="number"
								step="0.001"
								value={t.offPeakCents}
							/></label
						>
						<label
							>Supply (c/day)<input
								class="field"
								name="t{i}.supplyCentsPerDay"
								type="number"
								step="0.001"
								value={t.supplyCentsPerDay}
							/></label
						>
						<label
							>Feed-in (c)<input
								class="field"
								name="t{i}.feedInCents"
								type="number"
								step="0.001"
								value={t.feedInCents}
							/></label
						>
						<label
							>GST (%)<input
								class="field"
								name="t{i}.gstPct"
								type="number"
								step="0.1"
								value={Math.round(t.gstRate * 1000) / 10}
							/></label
						>
						<label
							>Usage discount (%)<input
								class="field"
								name="t{i}.usageDiscountPct"
								type="number"
								step="0.1"
								value={t.usageDiscountPct}
							/></label
						>
						{#if data.config.tariffs.length > 1}
							<label class="flex items-center gap-2 self-end pb-2"
								><input type="checkbox" name="t{i}.remove" /> Remove</label
							>
						{/if}
					</fieldset>
				{/each}
				<button class="btn self-start" formaction="?/addTariff">Add new rates from today</button>
			</section>

			<section class="panel">
				<h2>Connections</h2>
				<label>
					Inverter address
					<input
						class="field"
						name="inverterHost"
						value={data.config.inverterHost}
						disabled={isLocked('inverterHost')}
					/>
				</label>
				<p class="hint">
					{#if data.status.inverter.stale}
						<span class="text-[var(--wait-icon)]">Not responding</span>{data.status.inverter
							.lastError
							? `: ${data.status.inverter.lastError}`
							: ''}
					{:else}
						Last reading {ago(data.status.inverter.lastReading)}
					{/if}
					· Archive synced {ago(data.status.archive.lastSync)}{data.status.archive.lastError
						? ` (error: ${data.status.archive.lastError})`
						: ''}
				</p>
				<label>
					Solcast site ID
					<input
						class="field"
						name="solcastResourceId"
						value={data.config.solcastResourceId}
						placeholder="abcd-1234-ef56-7890"
						disabled={isLocked('solcast.resourceId')}
					/>
				</label>
				<label>
					Solcast API key
					<input
						class="field"
						name="solcastApiKey"
						type="password"
						autocomplete="off"
						placeholder={data.config.solcastKeySet
							? 'Saved. Leave blank to keep it.'
							: 'Paste your API key'}
						disabled={isLocked('solcast.apiKey')}
					/>
				</label>
				<p class="hint">
					{#if !data.config.solcastKeySet || !data.config.solcastResourceId}
						Without Solcast, cards use live readings only.
					{:else}
						Forecast updated {ago(data.status.solcast.lastFetch)}, {data.status.solcast.callsToday} of
						about 10 free calls used today{data.status.solcast.lastError
							? `. Last error: ${data.status.solcast.lastError}`
							: ''}.
					{/if}
				</p>
				{#if data.config.solcastKeySet}
					<div class="flex flex-wrap gap-3">
						<button class="btn" formaction="?/refreshForecast">Refresh forecast now</button>
						<label class="flex items-center gap-2"
							><input type="checkbox" name="solcastClearKey" /> Remove saved key</label
						>
					</div>
				{/if}
				{#if data.locked.length}
					<p class="hint">Greyed-out fields are set by the container’s environment variables.</p>
				{/if}
			</section>

			<section class="panel">
				<h2>Settings PIN</h2>
				<label>
					New PIN (leave blank to keep the current one)
					<input
						class="field"
						name="newPin"
						type="password"
						inputmode="numeric"
						autocomplete="new-password"
						disabled={isLocked('settingsPin')}
					/>
				</label>
			</section>

			<div class="sticky bottom-4 flex items-center justify-end gap-3">
				{#if form?.saved}
					<span class="rounded-full bg-[var(--go-bg)] px-3 py-1 text-[var(--go-text)]">Saved</span>
				{:else if form?.error}
					<span class="rounded-full bg-[var(--wait-bg)] px-3 py-1 text-[var(--wait-text)]"
						>{form.error}</span
					>
				{/if}
				<button class="btn-primary shadow-lg" disabled={busy}
					>{busy ? 'Saving…' : 'Save changes'}</button
				>
			</div>
		</form>

		<form
			method="POST"
			action="?/import"
			enctype="multipart/form-data"
			use:enhance={submit}
			class="panel"
		>
			<h2>Import Solar.web history</h2>
			<p class="hint">
				In Solar.web, export the <b>Energy balance</b> with daily values, one year at a time. Days the
				inverter already has 5-minute data for are left alone.
			</p>
			<input type="file" name="files" accept=".xlsx" multiple class="text-sm" />
			<button class="btn self-start" disabled={busy}>Import</button>
			<p class="hint">
				{data.status.counts.intervals} five-minute readings{data.status.counts.intervalsFrom
					? ` from ${data.status.counts.intervalsFrom}`
					: ''} ·
				{data.status.counts.importedDays} imported days{data.status.counts.importedFrom
					? ` (${data.status.counts.importedFrom} to ${data.status.counts.importedTo})`
					: ''}
			</p>
		</form>
	{/if}
</main>

<style>
	:global(.panel) {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		border-radius: 1rem;
		background: var(--surface-2);
		padding: 1.25rem;
	}
	:global(.panel h2) {
		font-size: 1.15rem;
		font-weight: 600;
	}
	:global(.panel label) {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.9rem;
		color: var(--text-secondary);
	}
	:global(.hint) {
		font-size: 0.85rem;
		color: var(--text-muted);
	}
	:global(.field) {
		border: 1px solid var(--border);
		background: var(--surface-1);
		color: var(--text-primary);
		border-radius: 0.6rem;
		padding: 0.55rem 0.7rem;
		font-size: 1rem;
	}
	:global(.field:disabled) {
		opacity: 0.55;
	}
	:global(.btn),
	:global(.btn-primary) {
		border-radius: 999px;
		padding: 0.6rem 1.2rem;
		font-weight: 500;
	}
	:global(.btn) {
		border: 1px solid var(--border);
		background: var(--surface-1);
	}
	:global(.btn-primary) {
		background: var(--text-primary);
		color: var(--surface-1);
	}
	:global(.btn-primary:disabled) {
		opacity: 0.6;
	}
</style>
