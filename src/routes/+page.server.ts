import { snapshot } from '$lib/server/live';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ snapshot: snapshot() });
