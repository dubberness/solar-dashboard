import { getConfig } from '$lib/server/config';
import { getDb } from '$lib/server/db';
import { addDays, history, type Period } from '$lib/server/history';
import { localDate, localMidnight } from '$lib/tou';
import type { PageServerLoad } from './$types';

const PERIODS: Period[] = ['day', 'week', 'month', 'year'];

function shift(period: Period, date: string, dir: 1 | -1): string {
	const [y, m] = date.split('-').map(Number);
	switch (period) {
		case 'day':
			return addDays(date, dir);
		case 'week':
			return addDays(date, 7 * dir);
		case 'month': {
			const d = new Date(Date.UTC(y, m - 1 + dir, 1));
			return d.toISOString().slice(0, 10);
		}
		case 'year':
			return `${y + dir}-01-01`;
	}
}

export const load: PageServerLoad = ({ url }) => {
	const p = url.searchParams.get('period') as Period;
	const period: Period = PERIODS.includes(p) ? p : 'month';
	const today = localDate(Date.now());
	const raw = url.searchParams.get('date');
	const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw <= today ? raw : today;
	const result = history(period, date, getConfig().tariffs);
	const next = shift(period, result.from, 1);

	const earliest = getDb()
		.prepare(
			`SELECT min(d) d FROM (SELECT min(date) d FROM daily_import
			 UNION ALL SELECT date(min(ts) / 1000, 'unixepoch', '+10 hours') FROM intervals)`
		)
		.get() as { d: string | null };

	return {
		period,
		date,
		result,
		prev: shift(period, result.from, -1),
		next: next <= today ? next : null,
		hasOlder: earliest.d !== null && earliest.d < result.from,
		dayStart: period === 'day' ? localMidnight(result.from) : null
	};
};
