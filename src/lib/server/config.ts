import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { DEFAULT_TARIFF } from '$lib/costing';
import type { Appliance, Tariff } from '$lib/types';
import type { ClockCorrection } from './archive';
import type { ForecastSource } from './forecast';

export interface AppConfig {
	inverterHost: string;
	pollSeconds: number;
	/** ChargeHA's address: the solar forecast and what the car is doing. */
	chargehaUrl: string;
	/** ChargeHA's READONLY_API_KEY, needed once its login is on. */
	chargehaToken: string;
	forecast: { source: ForecastSource };
	solcast: { apiKey: string; resourceId: string };
	/** Optional: the car's measured charging power, instead of estimating it from ChargeHA. */
	tessie: { token: string };
	appliances: Appliance[];
	tariffs: Tariff[];
	/** Periods the inverter's clock was wrong, applied to its archive. */
	clockCorrections: ClockCorrection[];
	settingsPin: string;
}

export const DEFAULT_APPLIANCES: Appliance[] = [
	{
		id: 'washer',
		name: 'Washing machine',
		icon: 'washer',
		thresholdKw: 1.3,
		typicalKw: 0.5,
		cycleHours: 1.5
	},
	{ id: 'dryer', name: 'Dryer', icon: 'dryer', thresholdKw: 1.2, typicalKw: 0.9, cycleHours: 2.5 }
];

const DEFAULTS: AppConfig = {
	inverterHost: '192.168.1.8',
	pollSeconds: 5,
	chargehaUrl: '',
	chargehaToken: '',
	forecast: { source: 'chargeha' },
	solcast: { apiKey: '', resourceId: '' },
	tessie: { token: '' },
	appliances: DEFAULT_APPLIANCES,
	tariffs: [DEFAULT_TARIFF],
	clockCorrections: [],
	settingsPin: '0000'
};

/** Environment variables that override the config file, keyed by config path. */
const ENV_OVERRIDES = {
	inverterHost: 'INVERTER_HOST',
	chargehaUrl: 'CHARGEHA_URL',
	chargehaToken: 'CHARGEHA_TOKEN',
	'solcast.apiKey': 'SOLCAST_API_KEY',
	'solcast.resourceId': 'SOLCAST_RESOURCE_ID',
	'tessie.token': 'TESSIE_TOKEN',
	settingsPin: 'SETTINGS_PIN'
} as const;

export function dataDir(): string {
	const dir = env.DATA_DIR || path.resolve('data');
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

const configPath = () => path.join(dataDir(), 'config.json');

let cached: AppConfig | null = null;

function readFile(): Partial<AppConfig> {
	try {
		return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
	} catch {
		return {};
	}
}

export function envLocked(): Set<string> {
	return new Set(
		Object.entries(ENV_OVERRIDES)
			.filter(([, name]) => env[name])
			.map(([key]) => key)
	);
}

/** Configs saved before the switch from evcc to ChargeHA still say "evcc". */
function forecastSource(saved: string | undefined): ForecastSource {
	return saved === 'solcast' || saved === 'none' ? saved : 'chargeha';
}

export function getConfig(): AppConfig {
	if (cached) return cached;
	const file = readFile();
	const cfg: AppConfig = {
		...DEFAULTS,
		...file,
		forecast: { source: forecastSource(file.forecast?.source) },
		solcast: { ...DEFAULTS.solcast, ...file.solcast },
		tessie: { ...DEFAULTS.tessie, ...file.tessie },
		appliances: file.appliances?.length ? file.appliances : DEFAULTS.appliances,
		tariffs: file.tariffs?.length ? file.tariffs : DEFAULTS.tariffs
	};
	if (env.INVERTER_HOST) cfg.inverterHost = env.INVERTER_HOST;
	if (env.CHARGEHA_URL) cfg.chargehaUrl = env.CHARGEHA_URL;
	if (env.CHARGEHA_TOKEN) cfg.chargehaToken = env.CHARGEHA_TOKEN;
	if (env.SOLCAST_API_KEY) cfg.solcast.apiKey = env.SOLCAST_API_KEY;
	if (env.SOLCAST_RESOURCE_ID) cfg.solcast.resourceId = env.SOLCAST_RESOURCE_ID;
	if (env.TESSIE_TOKEN) cfg.tessie.token = env.TESSIE_TOKEN;
	if (env.SETTINGS_PIN) cfg.settingsPin = env.SETTINGS_PIN;
	cached = cfg;
	return cfg;
}

export function saveConfig(next: AppConfig): void {
	fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
	cached = null;
}
