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
	const whenText = (ts: number) =>
		new Intl.DateTimeFormat('en-AU', {
			timeZone: 'Australia/Hobart',
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(ts);
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
						{#if Math.abs(data.status.inverter.clockSkewMs ?? 0) >= 2 * 60_000}
							<span class="text-[var(--okay-icon)]"
								>Inverter clock is {Math.round(
									Math.abs(data.status.inverter.clockSkewMs!) / 60_000
								)} min {data.status.inverter.clockSkewMs! > 0 ? 'fast' : 'slow'}; history times are
								being corrected.</span
							>
						{/if}
						Last reading {ago(data.status.inverter.lastReading)}
					{/if}
					· Archive synced {ago(data.status.archive.lastSync)}{data.status.archive.lastError
						? ` (error: ${data.status.archive.lastError})`
						: ''}
				</p>
				<details class="flex flex-col gap-3" open={data.config.clockCorrections.length > 0}>
					<summary class="cursor-pointer text-sm text-[var(--text-secondary)]"
						>Inverter clock was wrong?</summary
					>
					<div class="mt-3 flex flex-col gap-3">
						<p class="hint">
							The inverter stamps its history with its own clock. If that clock was wrong and has
							since been set right, record it here and the history is re-read from the inverter with
							the times corrected. This takes about half an hour.
						</p>
						{#each data.config.clockCorrections as c, i (c.until)}
							<div class="flex flex-wrap items-center gap-3">
								<span
									>{Math.abs(c.minutesFast)} min {c.minutesFast > 0 ? 'fast' : 'slow'} until {whenText(
										c.until
									)}</span
								>
								<button class="btn" formaction="?/removeClockCorrection" name="clockIndex" value={i}
									>Remove</button
								>
							</div>
						{/each}
						<div class="flex flex-wrap items-end gap-3">
							<label class="w-24">
								Minutes
								<input class="field" name="clockMinutes" type="number" min="1" max="720" />
							</label>
							<label class="w-28">
								<span>&nbsp;</span>
								<select class="field" name="clockDirection">
									<option value="fast">fast</option>
									<option value="slow">slow</option>
								</select>
							</label>
							<label>
								Until it was set right at
								<input class="field" name="clockUntil" type="datetime-local" />
							</label>
						</div>
						<button class="btn self-start" formaction="?/correctClock">Correct the history</button>
						{#if data.status.archive.rebuilding}
							<p class="hint">Re-reading history from the inverter…</p>
						{:else if data.status.archive.rebuiltAt}
							<p class="hint">History re-read {ago(data.status.archive.rebuiltAt)}.</p>
						{/if}
					</div>
				</details>
				<fieldset class="flex flex-col gap-2">
					<span class="text-sm text-[var(--text-secondary)]">Solar forecast from</span>
					<label class="!flex-row items-center gap-2 !text-base !text-[var(--text-primary)]">
						<input
							type="radio"
							name="forecastSource"
							value="evcc"
							checked={data.config.forecastSource === 'evcc'}
						/>
						evcc (recommended, uses no Solcast calls of its own)
					</label>
					<label class="!flex-row items-center gap-2 !text-base !text-[var(--text-primary)]">
						<input
							type="radio"
							name="forecastSource"
							value="solcast"
							checked={data.config.forecastSource === 'solcast'}
						/>
						Solcast directly (shares the account's ~10 daily calls)
					</label>
					<label class="!flex-row items-center gap-2 !text-base !text-[var(--text-primary)]">
						<input
							type="radio"
							name="forecastSource"
							value="none"
							checked={data.config.forecastSource === 'none'}
						/>
						No forecast (live readings only)
					</label>
				</fieldset>
				<label>
					evcc address
					<input
						class="field"
						name="evccUrl"
						value={data.config.evccUrl}
						placeholder="http://192.168.1.3:7070"
						disabled={isLocked('forecast.evccUrl')}
					/>
				</label>
				<details class="flex flex-col gap-3">
					<summary class="cursor-pointer text-sm text-[var(--text-secondary)]"
						>Direct Solcast settings</summary
					>
					<div class="mt-3 flex flex-col gap-3">
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
						{#if data.config.solcastKeySet}
							<label class="!flex-row items-center gap-2"
								><input type="checkbox" name="solcastClearKey" /> Remove saved key</label
							>
						{/if}
					</div>
				</details>
				<p class="hint">
					{#if data.status.forecast.source === 'none'}
						Cards use live readings only.
					{:else if !data.status.forecast.configured}
						Not set up yet. Cards use live readings only.
					{:else}
						Forecast updated {ago(data.status.forecast.lastFetch)}{data.status.forecast
							.callsToday !== null
							? `, ${data.status.forecast.callsToday} of about 10 Solcast calls used today`
							: ''}{data.status.forecast.lastError
							? `. Last error: ${data.status.forecast.lastError}`
							: ''}.
					{/if}
				</p>
				{#if data.status.forecast.configured}
					<button class="btn self-start" formaction="?/refreshForecast">Refresh forecast now</button
					>
				{/if}
				<label>
					Tessie API token (optional)
					<input
						class="field"
						name="tessieToken"
						type="password"
						autocomplete="off"
						placeholder={data.config.tessieTokenSet
							? 'Saved. Leave blank to keep it.'
							: 'Paste a token from Tessie → Settings → API'}
						disabled={isLocked('tessie.token')}
					/>
				</label>
				{#if data.config.tessieTokenSet && !isLocked('tessie.token')}
					<label class="!flex-row items-center gap-2"
						><input type="checkbox" name="tessieClearToken" /> Remove saved token</label
					>
				{/if}
				<p class="hint">
					{#if !data.status.tessie.configured}
						Without Tessie, the car’s charging power is estimated from evcc and the meter.
					{:else if data.status.tessie.lastError}
						Tessie: {data.status.tessie.lastError}. Using the estimate for now.
					{:else if data.status.tessie.measuredAt}
						Car charging power measured by the car {ago(data.status.tessie.measuredAt)}.
					{:else}
						Tessie is asked only while evcc says the car is charging.
					{/if}
				</p>
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
