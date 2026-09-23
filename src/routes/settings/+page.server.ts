import { fail } from '@sveltejs/kit';
import { isUnlocked, lock, refreshUnlock, unlock } from '$lib/server/auth';
import { envLocked, getConfig, saveConfig, type AppConfig } from '$lib/server/config';
import { getDb, kvGet } from '$lib/server/db';
import { health } from '$lib/server/live';
import { forecastStatus, refreshForecast, type ForecastSource } from '$lib/server/forecast';
import { parseEnergyBalance, storeDaily } from '$lib/server/solarweb';
import { tessieStatus } from '$lib/server/tessie';
import type { Appliance, Tariff } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ cookies }) => {
	if (!isUnlocked(cookies)) return { unlocked: false as const };
	const cfg = getConfig();
	const db = getDb();
	const counts = db
		.prepare(
			`SELECT (SELECT count(*) FROM intervals) intervals,
			        (SELECT date(min(ts) / 1000, 'unixepoch', '+10 hours') FROM intervals) intervalsFrom,
			        (SELECT count(*) FROM daily_import) importedDays,
			        (SELECT min(date) FROM daily_import) importedFrom,
			        (SELECT max(date) FROM daily_import) importedTo`
		)
		.get() as Record<string, number | string | null>;
	return {
		unlocked: true as const,
		config: {
			inverterHost: cfg.inverterHost,
			forecastSource: cfg.forecast.source,
			evccUrl: cfg.forecast.evccUrl,
			solcastResourceId: cfg.solcast.resourceId,
			solcastKeySet: Boolean(cfg.solcast.apiKey),
			tessieTokenSet: Boolean(cfg.tessie.token),
			appliances: cfg.appliances,
			tariffs: [...cfg.tariffs].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
		},
		locked: [...envLocked()],
		status: {
			inverter: health(),
			forecast: forecastStatus(),
			tessie: tessieStatus(),
			archive: {
				lastSync: Number(kvGet('archive_last_sync') ?? 0) || null,
				lastError: kvGet('archive_last_error') || null
			},
			counts
		}
	};
};

const num = (form: FormData, key: string, min: number, max: number): number => {
	const v = Number(form.get(key));
	if (!Number.isFinite(v) || v < min || v > max)
		throw new Error(`${key} must be between ${min} and ${max}`);
	return v;
};

function guard(cookies: Parameters<typeof isUnlocked>[0]) {
	return isUnlocked(cookies) ? null : fail(401, { error: 'Enter the PIN first.' });
}

export const actions: Actions = {
	unlock: async ({ request, cookies }) => {
		const pin = String((await request.formData()).get('pin') ?? '');
		if (!unlock(cookies, pin)) return fail(400, { error: 'That PIN isn’t right.' });
	},

	lock: ({ cookies }) => {
		lock(cookies);
	},

	save: async ({ request, cookies }) => {
		const denied = guard(cookies);
		if (denied) return denied;
		const form = await request.formData();
		const cfg = getConfig();
		const locked = envLocked();
		try {
			const appliances: Appliance[] = cfg.appliances.map((a) => ({
				...a,
				name: String(form.get(`${a.id}.name`) || a.name).slice(0, 40),
				thresholdKw: num(form, `${a.id}.thresholdKw`, 0.1, 10),
				typicalKw: num(form, `${a.id}.typicalKw`, 0.05, 10),
				cycleHours: num(form, `${a.id}.cycleHours`, 0.25, 6)
			}));

			const count = Number(form.get('tariffCount'));
			const tariffs: Tariff[] = [];
			for (let i = 0; i < count; i++) {
				if (form.get(`t${i}.remove`)) continue;
				const effectiveFrom = String(form.get(`t${i}.effectiveFrom`));
				if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) throw new Error('Rates need a start date');
				tariffs.push({
					effectiveFrom,
					peakCents: num(form, `t${i}.peakCents`, 0, 200),
					offPeakCents: num(form, `t${i}.offPeakCents`, 0, 200),
					supplyCentsPerDay: num(form, `t${i}.supplyCentsPerDay`, 0, 1000),
					feedInCents: num(form, `t${i}.feedInCents`, 0, 100),
					gstRate: num(form, `t${i}.gstPct`, 0, 50) / 100,
					usageDiscountPct: num(form, `t${i}.usageDiscountPct`, 0, 100)
				});
			}
			if (!tariffs.length) throw new Error('Keep at least one set of rates');

			const next: AppConfig = {
				...cfg,
				appliances,
				tariffs,
				forecast: { ...cfg.forecast },
				solcast: { ...cfg.solcast },
				tessie: { ...cfg.tessie }
			};
			const source = String(form.get('forecastSource') ?? cfg.forecast.source);
			if (!['evcc', 'solcast', 'none'].includes(source)) throw new Error('Unknown forecast source');
			next.forecast.source = source as ForecastSource;
			if (!locked.has('forecast.evccUrl')) {
				const url = String(form.get('evccUrl') ?? '').trim();
				if (url && !/^https?:\/\/[\w.-]+(:\d+)?\/?$/.test(url))
					throw new Error('evcc address should look like http://192.168.1.3:7070');
				next.forecast.evccUrl = url;
			}
			if (!locked.has('inverterHost')) {
				const host = String(form.get('inverterHost') ?? '').trim();
				if (!/^[\w.-]+(:\d+)?$/.test(host)) throw new Error('Inverter address looks wrong');
				next.inverterHost = host;
			}
			if (!locked.has('solcast.resourceId'))
				next.solcast.resourceId = String(form.get('solcastResourceId') ?? '').trim();
			const key = String(form.get('solcastApiKey') ?? '').trim();
			if (!locked.has('solcast.apiKey') && key) next.solcast.apiKey = key;
			if (!locked.has('solcast.apiKey') && form.get('solcastClearKey')) next.solcast.apiKey = '';
			const tessieToken = String(form.get('tessieToken') ?? '').trim();
			if (!locked.has('tessie.token') && tessieToken) next.tessie.token = tessieToken;
			if (!locked.has('tessie.token') && form.get('tessieClearToken')) next.tessie.token = '';
			const pin = String(form.get('newPin') ?? '').trim();
			if (pin && !locked.has('settingsPin')) {
				if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN must be 4 to 8 digits');
				next.settingsPin = pin;
			}
			saveConfig(next);
			if (pin) refreshUnlock(cookies);
			// Pick up a new source or address straight away rather than on the next tick.
			void refreshForecast(true);
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
		return { saved: true };
	},

	addTariff: ({ cookies }) => {
		const denied = guard(cookies);
		if (denied) return denied;
		const cfg = getConfig();
		const latest = [...cfg.tariffs].sort((a, b) =>
			b.effectiveFrom.localeCompare(a.effectiveFrom)
		)[0];
		const today = new Date().toISOString().slice(0, 10);
		saveConfig({ ...cfg, tariffs: [...cfg.tariffs, { ...latest, effectiveFrom: today }] });
	},

	refreshForecast: async ({ cookies }) => {
		const denied = guard(cookies);
		if (denied) return denied;
		await refreshForecast(true);
		const s = forecastStatus();
		if (s.lastError) return fail(502, { error: `Forecast: ${s.lastError}` });
		return { forecastRefreshed: true };
	},

	import: async ({ request, cookies }) => {
		const denied = guard(cookies);
		if (denied) return denied;
		const files = (await request.formData())
			.getAll('files')
			.filter((f): f is File => f instanceof File && f.size > 0);
		if (!files.length) return fail(400, { error: 'Choose one or more Solar.web .xlsx exports.' });
		let total = 0;
		const ranges: string[] = [];
		try {
			for (const f of files) {
				const rows = await parseEnergyBalance(Buffer.from(await f.arrayBuffer()));
				total += storeDaily(rows);
				if (rows.length) ranges.push(`${rows[0].date} to ${rows.at(-1)!.date}`);
			}
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
		return { imported: `Imported ${total} days (${ranges.join(', ')}).` };
	}
};
