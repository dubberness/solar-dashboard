import fs from 'node:fs';
import path from 'node:path';
import { env } from '$env/dynamic/private';
import { DEFAULT_TARIFF } from '$lib/costing';
import type { Appliance, Tariff } from '$lib/types';

export interface AppConfig {
	inverterHost: string;
	pollSeconds: number;
	solcast: { apiKey: string; resourceId: string };
	appliances: Appliance[];
	tariffs: Tariff[];
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
	solcast: { apiKey: '', resourceId: '' },
	appliances: DEFAULT_APPLIANCES,
	tariffs: [DEFAULT_TARIFF],
	settingsPin: '0000'
};

/** Environment variables that override the config file, keyed by config path. */
const ENV_OVERRIDES = {
	inverterHost: 'INVERTER_HOST',
	'solcast.apiKey': 'SOLCAST_API_KEY',
	'solcast.resourceId': 'SOLCAST_RESOURCE_ID',
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

export function getConfig(): AppConfig {
	if (cached) return cached;
	const file = readFile();
	const cfg: AppConfig = {
		...DEFAULTS,
		...file,
		solcast: { ...DEFAULTS.solcast, ...file.solcast },
		appliances: file.appliances?.length ? file.appliances : DEFAULTS.appliances,
		tariffs: file.tariffs?.length ? file.tariffs : DEFAULTS.tariffs
	};
	if (env.INVERTER_HOST) cfg.inverterHost = env.INVERTER_HOST;
	if (env.SOLCAST_API_KEY) cfg.solcast.apiKey = env.SOLCAST_API_KEY;
	if (env.SOLCAST_RESOURCE_ID) cfg.solcast.resourceId = env.SOLCAST_RESOURCE_ID;
	if (env.SETTINGS_PIN) cfg.settingsPin = env.SETTINGS_PIN;
	cached = cfg;
	return cfg;
}

export function saveConfig(next: AppConfig): void {
	fs.writeFileSync(configPath(), JSON.stringify(next, null, 2));
	cached = null;
}
