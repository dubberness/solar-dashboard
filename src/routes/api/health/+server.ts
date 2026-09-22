import { json } from '@sveltejs/kit';
import { health } from '$lib/server/live';

export const GET = () => {
	const h = health();
	// Unhealthy only once the app has had a chance to take a first reading.
	return json(h, { status: h.lastError && h.stale && h.lastReading === null ? 503 : 200 });
};
