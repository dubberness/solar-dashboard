import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { addDays, daySeries } from '$lib/server/history';
import { openInterval } from '$lib/server/live';
import { localDate, localMidnight } from '$lib/tou';

export const GET = () => {
	const date = localDate(Date.now());
	const forecast = getDb()
		.prepare(
			'SELECT period_end, pv_kw FROM forecast WHERE period_end > ? AND period_end <= ? ORDER BY period_end'
		)
		.all(localMidnight(date), localMidnight(addDays(date, 1))) as Array<{
		period_end: number;
		pv_kw: number;
	}>;
	// House use leaves the car out, like the Using tile; the chart stacks the car on top.
	const series = daySeries(date).map((r) => ({
		...r,
		useKw: Math.max(0, r.useKw - r.carKw)
	}));
	const open = openInterval();
	if (open && open.ts > (series.at(-1)?.ts ?? 0)) series.push(open);
	return json({
		date,
		dayStart: localMidnight(date),
		dayEnd: localMidnight(addDays(date, 1)),
		series,
		// Plot each 30-minute forecast at its midpoint.
		forecast: forecast.map((f) => ({ ts: f.period_end - 15 * 60_000, pvKw: f.pv_kw }))
	});
};
