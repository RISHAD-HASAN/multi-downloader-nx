// Content key vaults.
//
// Caches KID -> CONTENT KEY per service so re-downloading a title (or grabbing
// another dub that shares keys) never hits the licence server again. Local
// vaults are checked before network ones. The SQLite schema matches devine's,
// so an existing key_vault.db can be pointed at directly.

import fs from 'fs';
import path from 'path';
import { console } from './log';

export const NULL_KEY = '0'.repeat(32);

export function normaliseKid(kid: string): string {
	return kid.replace(/-/g, '').toLowerCase();
}

export function isNullKey(key?: string | null): boolean {
	return !key || /^0+$/.test(key);
}

export interface KeyPair {
	kid: string;
	key: string;
}

// Base class for every vault backend.
export abstract class Vault {
	// Local vaults are tried before network vaults by the Vaults manager
	public local = false;

	constructor(
		public name: string,
		public noPush = false
	) {}

	public toString(): string {
		return `${this.name} ${this.constructor.name}`;
	}

	// Look up a single content key by KID for a service
	abstract getKey(kid: string, service: string): Promise<string | undefined>;
	// All known keys for a service
	abstract getKeys(service: string): Promise<KeyPair[]>;
	// Store one KID:KEY. Returns true if stored (or already present)
	abstract addKey(service: string, kid: string, key: string): Promise<boolean>;
	// Store many; returns the number of *new* keys written
	abstract addKeys(service: string, pairs: KeyPair[]): Promise<number>;
	// Service namespaces this vault knows about
	abstract getServices(): Promise<string[]>;
}


type SqliteModule = {
	DatabaseSync: new (path: string) => {
		exec(sql: string): void;
		prepare(sql: string): { all(...p: any[]): any[]; get(...p: any[]): any; run(...p: any[]): any };
		close(): void;
	};
};

function loadSqlite(): SqliteModule | undefined {
	try {
		// node:sqlite ships with Node >= 22.5 (the engine this project targets)
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		return require('node:sqlite') as SqliteModule;
	} catch {
		return undefined;
	}
}

/**
 * SQLite vault - one table per service, `kid` TEXT PK + `key_` TEXT.
 * Table layout is byte-compatible with unshackle/devine vaults, so an existing
 * `key_vault.db` from unshackle can be pointed at directly.
 */
export class SQLiteVault extends Vault {
	public local = true;
	private db?: ReturnType<SqliteModule['DatabaseSync']['prototype']['constructor']> | any;
	private available = true;

	constructor(
		name: string,
		public dbPath: string,
		noPush = false
	) {
		super(name, noPush);
	}

	private connect(): any {
		if (this.db) return this.db;
		const sqlite = loadSqlite();
		if (!sqlite) {
			if (this.available) {
				console.warn(`Vault [text2]${this.name}[/]: node:sqlite unavailable (needs Node >= 22.5) - vault disabled`);
				this.available = false;
			}
			return undefined;
		}
		const dir = path.dirname(this.dbPath);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		this.db = new sqlite.DatabaseSync(this.dbPath);
		this.db.exec('PRAGMA journal_mode=WAL');
		return this.db;
	}

	// Service tables are matched case-insensitively, like unshackle
	private resolveTable(service: string): string | undefined {
		const db = this.connect();
		if (!db) return undefined;
		const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
		return rows.find((r) => r.name.toLowerCase() === service.toLowerCase())?.name;
	}

	private createTable(service: string) {
		const db = this.connect();
		if (!db) return;
		db.exec(
			`CREATE TABLE IF NOT EXISTS "${service.replace(/"/g, '')}" (` +
				'id INTEGER PRIMARY KEY AUTOINCREMENT, kid TEXT NOT NULL COLLATE NOCASE, key_ TEXT NOT NULL COLLATE NOCASE, ' +
				'UNIQUE(kid, key_))'
		);
	}

	async getKey(kid: string, service: string): Promise<string | undefined> {
		const table = this.resolveTable(service);
		if (!table) return undefined;
		const row = this.connect()
			.prepare(`SELECT key_ FROM "${table}" WHERE kid = ? AND key_ != ?`)
			.get(normaliseKid(kid), NULL_KEY);
		return row?.key_;
	}

	async getKeys(service: string): Promise<KeyPair[]> {
		const table = this.resolveTable(service);
		if (!table) return [];
		return (this.connect().prepare(`SELECT kid, key_ FROM "${table}" WHERE key_ != ?`).all(NULL_KEY) as any[]).map((r) => ({
			kid: r.kid,
			key: r.key_
		}));
	}

	async addKey(service: string, kid: string, key: string): Promise<boolean> {
		return (await this.addKeys(service, [{ kid, key }])) >= 0;
	}

	async addKeys(service: string, pairs: KeyPair[]): Promise<number> {
		const db = this.connect();
		if (!db) return 0;
		const usable = pairs.filter((p) => !isNullKey(p.key));
		if (!usable.length) return 0;
		const table = this.resolveTable(service) ?? service;
		this.createTable(table);
		const stmt = db.prepare(`INSERT OR IGNORE INTO "${table}" (kid, key_) VALUES (?, ?)`);
		let added = 0;
		for (const { kid, key } of usable) {
			const res = stmt.run(normaliseKid(kid), key.toLowerCase());
			if (res?.changes) added += Number(res.changes);
		}
		return added;
	}

	async getServices(): Promise<string[]> {
		const db = this.connect();
		if (!db) return [];
		return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[]).map(
			(r) => r.name
		);
	}
}

/**
 * JSON-file vault - zero-dependency local fallback for environments without
 * `node:sqlite`. Same semantics, stored as `{ service: { kid: key } }`.
 */
export class JSONVault extends Vault {
	public local = true;
	private cache?: Record<string, Record<string, string>>;

	constructor(
		name: string,
		public filePath: string,
		noPush = false
	) {
		super(name, noPush);
	}

	private load(): Record<string, Record<string, string>> {
		if (this.cache) return this.cache;
		try {
			this.cache = fs.existsSync(this.filePath) ? JSON.parse(fs.readFileSync(this.filePath, 'utf8')) : {};
		} catch {
			this.cache = {};
		}
		return this.cache!;
	}

	private save() {
		const dir = path.dirname(this.filePath);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(this.filePath, JSON.stringify(this.load(), null, '\t'));
	}

	private bucket(service: string): Record<string, string> {
		const data = this.load();
		const existing = Object.keys(data).find((k) => k.toLowerCase() === service.toLowerCase());
		const key = existing ?? service;
		data[key] ??= {};
		return data[key];
	}

	async getKey(kid: string, service: string): Promise<string | undefined> {
		const v = this.bucket(service)[normaliseKid(kid)];
		return isNullKey(v) ? undefined : v;
	}

	async getKeys(service: string): Promise<KeyPair[]> {
		return Object.entries(this.bucket(service))
			.filter(([, key]) => !isNullKey(key))
			.map(([kid, key]) => ({ kid, key }));
	}

	async addKey(service: string, kid: string, key: string): Promise<boolean> {
		return (await this.addKeys(service, [{ kid, key }])) >= 0;
	}

	async addKeys(service: string, pairs: KeyPair[]): Promise<number> {
		const bucket = this.bucket(service);
		let added = 0;
		for (const { kid, key } of pairs) {
			if (isNullKey(key)) continue;
			const k = normaliseKid(kid);
			if (bucket[k] === key.toLowerCase()) continue;
			bucket[k] = key.toLowerCase();
			added++;
		}
		if (added) this.save();
		return added;
	}

	async getServices(): Promise<string[]> {
		return Object.keys(this.load());
	}
}


/**
 * HTTP/API vault - talks to a remote key store (the "API" vault format used by
 * unshackle: POST {method, params, ...} with an `X-Secret-Key` header).
 */
export class APIVault extends Vault {
	public local = false;

	constructor(
		name: string,
		public uri: string,
		public token: string,
		noPush = false
	) {
		super(name, noPush);
		if (!/^https?:\/\//.test(this.uri)) this.uri = `https://${this.uri}`;
		this.uri = this.uri.replace(/\/+$/, '');
	}

	private async call(method: string, params: Record<string, any>): Promise<any> {
		const res = await fetch(this.uri, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Secret-Key': this.token },
			body: JSON.stringify({ method, params })
		});
		if (res.status === 401) throw new Error(`Vault ${this.name}: authentication rejected (bad token)`);
		let data: any;
		try {
			data = await res.json();
		} catch {
			throw new Error(`Vault ${this.name}: non-JSON response (HTTP ${res.status})`);
		}
		if (data?.status_code && data.status_code !== 200) {
			throw new Error(`Vault ${this.name}: ${data.message ?? `error ${data.status_code}`}`);
		}
		return data?.data ?? data;
	}

	async getKey(kid: string, service: string): Promise<string | undefined> {
		const data = await this.call('GetKey', { kid: normaliseKid(kid), service: service.toLowerCase() });
		const key = data?.content_key ?? data?.key;
		return isNullKey(key) ? undefined : key;
	}

	async getKeys(service: string): Promise<KeyPair[]> {
		const out: KeyPair[] = [];
		let page = 1;
		for (;;) {
			const data = await this.call('GetKeys', { service: service.toLowerCase(), page, total: 1000 });
			const keys: Record<string, string> = data?.content_keys ?? {};
			for (const [kid, key] of Object.entries(keys)) if (!isNullKey(key)) out.push({ kid, key });
			if (!data?.pages || page >= data.pages) break;
			page++;
		}
		return out;
	}

	async addKey(service: string, kid: string, key: string): Promise<boolean> {
		if (isNullKey(key)) return false;
		const data = await this.call('InsertKey', {
			service: service.toLowerCase(),
			kid: normaliseKid(kid),
			content_key: key.toLowerCase()
		});
		return Boolean(data?.inserted ?? true);
	}

	async addKeys(service: string, pairs: KeyPair[]): Promise<number> {
		const usable = pairs.filter((p) => !isNullKey(p.key));
		if (!usable.length) return 0;
		const data = await this.call('InsertKeys', {
			service: service.toLowerCase(),
			content_keys: Object.fromEntries(usable.map((p) => [normaliseKid(p.kid), p.key.toLowerCase()]))
		});
		return Number(data?.inserted ?? usable.length);
	}

	async getServices(): Promise<string[]> {
		const data = await this.call('GetServices', {});
		return data?.services ?? [];
	}
}


export interface VaultHit {
	kid: string;
	key: string;
	// Vault name the key came from, or undefined if it came from a licence
	from?: string;
}

/**
 * `Vaults` - iterates every configured vault, local ones first.
 * Mirrors unshackle/core/vaults.py.
 */
export class Vaults {
	public vaults: Vault[] = [];

	constructor(public service: string) {}

	get length(): number {
		return this.vaults.length;
	}

	load(vault: Vault) {
		this.vaults.push(vault);
		// local vaults are always consulted first
		this.vaults.sort((a, b) => Number(b.local) - Number(a.local));
	}

	// Get a key by KID; returns the key and the vault it came from
	async getKey(kid: string): Promise<{ key?: string; from?: Vault }> {
		for (const vault of this.vaults) {
			try {
				const key = await vault.getKey(kid, this.service);
				if (key && !isNullKey(key)) return { key, from: vault };
			} catch (e) {
				console.debug(`Vault [text2]${vault.name}[/] lookup failed: ${(e as Error).message}`);
			}
		}
		return {};
	}

	// Bulk-resolve KIDs, returning a map of found keys
	async getKeys(kids: string[]): Promise<Map<string, VaultHit>> {
		const found = new Map<string, VaultHit>();
		for (const kid of kids) {
			const norm = normaliseKid(kid);
			if (found.has(norm)) continue;
			const { key, from } = await this.getKey(norm);
			if (key) found.set(norm, { kid: norm, key, from: from?.name });
		}
		return found;
	}

	/**
	 * Push keys to every writable vault that is missing them.
	 * Returns the number of vaults that accepted at least one new key.
	 */
	async addKeys(pairs: KeyPair[]): Promise<number> {
		const usable = pairs.filter((p) => !isNullKey(p.key));
		if (!usable.length) return 0;
		let touched = 0;
		for (const vault of this.vaults) {
			if (vault.noPush) continue;
			try {
				const added = await vault.addKeys(this.service, usable);
				if (added > 0) {
					touched++;
					console.debug(`Cached [repr.number]${added}[/] key(s) to vault [text2]${vault.name}[/]`);
				}
			} catch (e) {
				console.debug(`Vault [text2]${vault.name}[/] write failed: ${(e as Error).message}`);
			}
		}
		return touched;
	}
}


export interface VaultConfig {
	type: 'SQLite' | 'JSON' | 'API' | 'HTTP';
	name?: string;
	path?: string;
	uri?: string;
	token?: string;
	no_push?: boolean;
}

/**
 * Build the vault chain from `config/vaults.yml`:
 *
 * ```yaml
 * key_vaults:
 *   - type: SQLite
 *     name: "Local Vault"
 *     path: "./config/key_vault.db"
 *   - type: API
 *     name: "Team Vault"
 *     uri: "https://vault.example.com/api"
 *     token: "…"
 *     no_push: false
 * ```
 */
export function buildVaults(service: string, configs: VaultConfig[] | undefined, workingDir: string): Vaults {
	const vaults = new Vaults(service);
	if (!configs?.length) return vaults;
	for (const cfg of configs) {
		try {
			const name = cfg.name ?? cfg.type;
			switch (cfg.type) {
				case 'SQLite':
					vaults.load(new SQLiteVault(name, path.resolve(workingDir, cfg.path ?? 'config/key_vault.db'), cfg.no_push));
					break;
				case 'JSON':
					vaults.load(new JSONVault(name, path.resolve(workingDir, cfg.path ?? 'config/key_vault.json'), cfg.no_push));
					break;
				case 'API':
				case 'HTTP':
					if (!cfg.uri) throw new Error('missing "uri"');
					vaults.load(new APIVault(name, cfg.uri, cfg.token ?? '', cfg.no_push));
					break;
				default:
					console.warn(`Unknown vault type [text2]${(cfg as VaultConfig).type}[/], skipping`);
			}
		} catch (e) {
			console.warn(`Failed to load vault [text2]${cfg.name ?? cfg.type}[/]: ${(e as Error).message}`);
		}
	}
	return vaults;
}
