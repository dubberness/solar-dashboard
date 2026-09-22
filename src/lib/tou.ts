// TasNetworks Tariff 93 time-of-use windows. The bill specifies them in AEST
// (UTC+10) all year, so during daylight saving they land an hour later on the
// wall clock. Working in fixed UTC+10 sidesteps DST entirely.

const AEST_OFFSET_MS = 10 * 3600 * 1000;
const PEAK_WINDOWS: Array<[number, number]> = [
	[7, 10],
	[16, 21]
];

export const HOBART_TZ = 'Australia/Hobart';

function aestParts(ts: number) {
	const d = new Date(ts + AEST_OFFSET_MS);
	return { day: d.getUTCDay(), hour: d.getUTCHours() + d.getUTCMinutes() / 60 };
}

export function isPeak(ts: number): boolean {
	const { day, hour } = aestParts(ts);
	if (day === 0 || day === 6) return false;
	return PEAK_WINDOWS.some(([s, e]) => hour >= s && hour < e);
}

/** Epoch ms of the next moment the peak/off-peak state flips, searching up to 4 days. */
export function nextChange(ts: number): number {
	const current = isPeak(ts);
	const hourMs = 3600 * 1000;
	// Boundaries are always on the AEST hour, so step to the next hour then hourly.
	let t = Math.floor((ts + AEST_OFFSET_MS) / hourMs) * hourMs - AEST_OFFSET_MS + hourMs;
	for (let i = 0; i < 24 * 4; i++, t += hourMs) {
		if (isPeak(t) !== current) return t;
	}
	return t;
}

export function formatTime(ts: number, now?: number): string {
	const time = new Intl.DateTimeFormat('en-AU', {
		timeZone: HOBART_TZ,
		hour: 'numeric',
		minute: '2-digit'
	})
		.format(ts)
		.replace(':00', '')
		.replace(/\s/g, '')
		.toLowerCase();
	if (now === undefined) return time;
	const day = (t: number) => localDate(t);
	if (day(ts) === day(now)) return time;
	if (day(ts) === day(now + 24 * 3600 * 1000)) return `${time} tomorrow`;
	const weekday = new Intl.DateTimeFormat('en-AU', { timeZone: HOBART_TZ, weekday: 'long' }).format(
		ts
	);
	return `${time} ${weekday}`;
}

/** YYYY-MM-DD in Hobart local time. */
export function localDate(ts: number): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: HOBART_TZ,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(ts);
}

/** Epoch ms of local midnight at the start of a YYYY-MM-DD in Hobart. */
export function localMidnight(date: string): number {
	const [y, m, d] = date.split('-').map(Number);
	// Hobart is UTC+10 or +11; try both and keep the one that round-trips.
	for (const offset of [11, 10]) {
		const guess = Date.UTC(y, m - 1, d) - offset * 3600 * 1000;
		if (localDate(guess) === date && localDate(guess - 1) !== date) return guess;
	}
	return Date.UTC(y, m - 1, d) - 10 * 3600 * 1000;
}

export function periodLabel(now: number): { isPeak: boolean; label: string } {
	const peak = isPeak(now);
	const change = nextChange(now);
	const when = formatTime(change, now);
	if (peak) return { isPeak: true, label: `Peak price until ${when}` };
	const hoursAway = (change - now) / 3600000;
	if (hoursAway > 24) return { isPeak: false, label: 'Off-peak all weekend' };
	return { isPeak: false, label: `Off-peak until ${when}` };
}
