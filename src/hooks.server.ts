import type { ServerInit } from '@sveltejs/kit';
import { startBackgroundJobs } from '$lib/server/scheduler';

export const init: ServerInit = async () => {
	startBackgroundJobs();
};
