import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getConfig } from '$lib/server/config';
import { history, type Period } from '$lib/server/history';
import { localDate } from '$lib/tou';

const PERIODS = new Set(['day', 'week', 'month', 'year']);

export const GET: RequestHandler = ({ url }) => {
	const period = url.searchParams.get('period') ?? 'day';
	const date = url.searchParams.get('date') ?? localDate(Date.now());
	if (!PERIODS.has(period)) error(400, 'period must be day, week, month or year');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) error(400, 'date must be YYYY-MM-DD');
	return json(history(period as Period, date, getConfig().tariffs));
};
