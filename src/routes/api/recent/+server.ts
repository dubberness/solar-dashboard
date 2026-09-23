import { json } from '@sveltejs/kit';
import { readingsSince } from '$lib/server/live';

/** Every reading from the last 30 minutes, to seed the realtime chart. */
export const GET = () => json(readingsSince(Date.now() - 30 * 60_000));
