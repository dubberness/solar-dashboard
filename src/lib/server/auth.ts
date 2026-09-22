// A PIN on the settings page, so nobody changes thresholds by accident. It's
// a guard rail on a home network, not security against a determined attacker.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Cookies } from '@sveltejs/kit';
import { dataDir, getConfig } from './config';

const COOKIE = 'solar_settings';
const MAX_AGE = 60 * 60 * 24 * 30;

let secret: Buffer | null = null;

function getSecret(): Buffer {
	if (secret) return secret;
	const file = path.join(dataDir(), '.secret');
	try {
		secret = fs.readFileSync(file);
	} catch {
		secret = crypto.randomBytes(32);
		fs.writeFileSync(file, secret, { mode: 0o600 });
	}
	return secret;
}

/** The token changes whenever the PIN does, logging everyone out. */
function token(): string {
	return crypto
		.createHmac('sha256', getSecret())
		.update(`pin:${getConfig().settingsPin}`)
		.digest('hex');
}

export function isUnlocked(cookies: Cookies): boolean {
	const got = cookies.get(COOKIE);
	if (!got) return false;
	const want = token();
	return got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export function unlock(cookies: Cookies, pin: string): boolean {
	const want = getConfig().settingsPin;
	const ok =
		pin.length === want.length && crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(want));
	if (ok) {
		cookies.set(COOKIE, token(), {
			path: '/',
			httpOnly: true,
			sameSite: 'strict',
			secure: false,
			maxAge: MAX_AGE
		});
	}
	return ok;
}

export function lock(cookies: Cookies): void {
	cookies.delete(COOKIE, { path: '/' });
}

export function refreshUnlock(cookies: Cookies): void {
	cookies.set(COOKIE, token(), {
		path: '/',
		httpOnly: true,
		sameSite: 'strict',
		secure: false,
		maxAge: MAX_AGE
	});
}
