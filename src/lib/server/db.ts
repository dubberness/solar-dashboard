import path from 'node:path';
import Database from 'better-sqlite3';
import { dataDir } from './config';

// intervals: 5-minute energy buckets keyed by start time (epoch ms). They come
//   from the inverter archive ("archive") or from integrating live readings
//   ("live"); archive rows win. Only the general circuit is metered.
// car_intervals: mean car charging per 5-minute bucket, from evcc, so the
//   typical-house-load profile can leave the car out.
// daily_import: whole-day totals from Solar.web exports, used for days with
//   no interval data.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS readings (
	ts INTEGER PRIMARY KEY,
	pv_w REAL NOT NULL,
	grid_w REAL NOT NULL,
	load_w REAL NOT NULL,
	import_wh REAL,
	export_wh REAL
);
CREATE TABLE IF NOT EXISTS intervals (
	ts INTEGER PRIMARY KEY,
	pv_wh REAL NOT NULL,
	import_wh REAL NOT NULL,
	export_wh REAL NOT NULL,
	is_peak INTEGER NOT NULL,
	source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS car_intervals (
	ts INTEGER PRIMARY KEY,
	car_wh REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS daily_import (
	date TEXT PRIMARY KEY,
	pv_wh REAL NOT NULL,
	import_wh REAL NOT NULL,
	export_wh REAL NOT NULL,
	source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS forecast (
	period_end INTEGER PRIMARY KEY,
	pv_kw REAL NOT NULL,
	fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

let db: Database.Database | null = null;

export function getDb(): Database.Database {
	if (db) return db;
	db = openDb(path.join(dataDir(), 'solar.db'));
	return db;
}

export function openDb(file: string): Database.Database {
	const d = new Database(file);
	d.pragma('journal_mode = WAL');
	d.pragma('synchronous = NORMAL');
	d.exec(SCHEMA);
	// Columns added after the first release.
	const readingCols = d.prepare('PRAGMA table_info(readings)').all() as Array<{ name: string }>;
	if (!readingCols.some((c) => c.name === 'car_w'))
		d.exec('ALTER TABLE readings ADD COLUMN car_w REAL');
	return d;
}

export function kvGet(key: string, d = getDb()): string | null {
	const row = d.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
		{ value: string } | undefined;
	return row?.value ?? null;
}

export function kvSet(key: string, value: string, d = getDb()): void {
	d.prepare(
		'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
	).run(key, value);
}
