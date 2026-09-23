import { syncArchive } from './archive';
import { getConfig } from './config';
import { purgeOldReadings, pollOnce } from './live';
import { log } from './log';
import { refreshForecast } from './forecast';

const g = globalThis as unknown as { __solarScheduler?: boolean };

export function startBackgroundJobs(): void {
	// Vite's dev server can re-run hooks on reload; only ever start one set of loops.
	if (g.__solarScheduler) return;
	g.__solarScheduler = true;
	const cfg = getConfig();
	log.info(`Polling inverter at ${cfg.inverterHost} every ${cfg.pollSeconds}s`);

	const loop = async () => {
		const started = Date.now();
		await pollOnce();
		setTimeout(loop, Math.max(500, getConfig().pollSeconds * 1000 - (Date.now() - started)));
	};
	loop();

	const every = (ms: number, fn: () => Promise<void> | void, initialDelay = 0) => {
		const run = () => Promise.resolve(fn()).catch((e) => log.error(String(e)));
		setTimeout(() => {
			run();
			setInterval(run, ms);
		}, initialDelay);
	};
	every(5 * 60_000, () => refreshForecast(), 3_000);
	every(60 * 60_000, syncArchive, 10_000);
	every(24 * 60 * 60_000, purgeOldReadings, 60_000);
}
