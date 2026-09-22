import type { RequestHandler } from './$types';
import { snapshot, subscribe } from '$lib/server/live';

// Server-sent events: one "snapshot" message per inverter poll.
export const GET: RequestHandler = ({ request }) => {
	let unsubscribe = () => {};
	const stream = new ReadableStream({
		start(controller) {
			const enc = new TextEncoder();
			const send = (data: unknown) => {
				try {
					controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
				} catch {
					unsubscribe();
				}
			};
			send(snapshot());
			unsubscribe = subscribe(send);
			request.signal.addEventListener('abort', () => {
				unsubscribe();
				try {
					controller.close();
				} catch {
					// already closed
				}
			});
		},
		cancel() {
			unsubscribe();
		}
	});
	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			'X-Accel-Buffering': 'no'
		}
	});
};
