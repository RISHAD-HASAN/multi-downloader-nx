// Vault lookup in front of the CDM.
//
// Pulls the KIDs out of the PSSH, asks the vaults, and only calls the licence
// server for whatever is still missing. Anything new gets written back.

import { console } from './log';
import { cekTree } from './module.console';
import { Padding } from './module.rich';
import { buildVaults, isNullKey, normaliseKid, Vaults, type KeyPair, type VaultConfig } from './module.vault';

export interface KeyContainerLike {
	kid: string;
	key: string;
}

const WIDEVINE_SYSTEM_ID = 'edef8ba979d64acea3c827dcd51d21ed';
const PLAYREADY_SYSTEM_ID = '9a04f07998404286ab92e65be0885f95';

function readU32(buf: Buffer, off: number): number {
	return buf.readUInt32BE(off);
}

/**
 * Extract Key IDs from a base64 PSSH box.
 * Handles v1 boxes (KIDs in the header), Widevine protobuf payloads (field 2)
 * and PlayReady WRMHEADER XML payloads.
 */
export function extractKids(pssh?: string): string[] {
	if (!pssh) return [];
	let buf: Buffer;
	try {
		buf = Buffer.from(pssh, 'base64');
	} catch {
		return [];
	}
	if (buf.length < 32) return [];

	// A bare Widevine protobuf (no box header) is also accepted
	if (buf.subarray(4, 8).toString('ascii') !== 'pssh') return dedupe(parseWidevineProtobuf(buf));

	const version = buf[8];
	const systemId = buf.subarray(12, 28).toString('hex');
	let off = 28;
	const kids: string[] = [];

	if (version > 0) {
		const count = readU32(buf, off);
		off += 4;
		for (let i = 0; i < count && off + 16 <= buf.length; i++) {
			kids.push(buf.subarray(off, off + 16).toString('hex'));
			off += 16;
		}
	}

	if (off + 4 <= buf.length) {
		const dataSize = readU32(buf, off);
		off += 4;
		const data = buf.subarray(off, Math.min(buf.length, off + dataSize));
		if (systemId === WIDEVINE_SYSTEM_ID) kids.push(...parseWidevineProtobuf(data));
		else if (systemId === PLAYREADY_SYSTEM_ID) kids.push(...parsePlayReadyHeader(data));
	}

	return dedupe(kids);
}

// Widevine PSSH protobuf: repeated bytes key_id = 2
function parseWidevineProtobuf(data: Buffer): string[] {
	const kids: string[] = [];
	let i = 0;
	while (i < data.length) {
		const tag = data[i];
		const field = tag >> 3;
		const wire = tag & 0x07;
		i++;
		if (wire === 2) {
			let len = 0;
			let shift = 0;
			while (i < data.length) {
				const b = data[i++];
				len |= (b & 0x7f) << shift;
				shift += 7;
				if (!(b & 0x80)) break;
			}
			if (field === 2 && len === 16 && i + 16 <= data.length) kids.push(data.subarray(i, i + 16).toString('hex'));
			i += len;
		} else if (wire === 0) {
			while (i < data.length && data[i] & 0x80) i++;
			i++;
		} else if (wire === 5) i += 4;
		else if (wire === 1) i += 8;
		else break;
	}
	return kids;
}

// PlayReady WRMHEADER (UTF-16LE XML) - <KID>base64</KID> / <KID VALUE="…"/>.
function parsePlayReadyHeader(data: Buffer): string[] {
	const start = data.length > 10 ? 10 : 0;
	let xml: string;
	try {
		xml = data.subarray(start).toString('utf16le');
	} catch {
		return [];
	}
	const kids: string[] = [];
	const re = /<KID[^>]*?(?:VALUE="([^"]+)"[^>]*\/>|>([^<]+)<\/KID>)/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml))) {
		const b64 = (m[1] ?? m[2] ?? '').trim();
		if (!b64) continue;
		const raw = Buffer.from(b64, 'base64');
		if (raw.length !== 16) continue;
		// PlayReady stores the first three GUID components little-endian
		const le = Buffer.from([raw[3], raw[2], raw[1], raw[0], raw[5], raw[4], raw[7], raw[6], ...raw.subarray(8)]);
		kids.push(le.toString('hex'));
	}
	return kids;
}

function dedupe(kids: string[]): string[] {
	return [...new Set(kids.map(normaliseKid))].filter((k) => k && k !== '0'.repeat(32));
}

let vaultsByService = new Map<string, Vaults>();
let vaultConfigs: VaultConfig[] | undefined;
let vaultWorkingDir = '.';
let vaultsEnabled = true;

// Called once at startup from the CLI entry point
export function configureVaults(configs: VaultConfig[] | undefined, workingDir: string, enabled = true) {
	vaultConfigs = configs;
	vaultWorkingDir = workingDir;
	vaultsEnabled = enabled;
	vaultsByService = new Map();
	if (enabled && configs?.length) {
		console.debug(`Loaded [repr.number]${configs.length}[/] key vault(s)`);
	}
}

export function getVaults(service: string): Vaults {
	let v = vaultsByService.get(service);
	if (!v) {
		v = buildVaults(service, vaultsEnabled ? vaultConfigs : [], vaultWorkingDir);
		vaultsByService.set(service, v);
	}
	return v;
}

export interface DrmResolveOptions {
	// Service namespace in the vault, e.g. "crunchyroll"
	service: string;
	// "Widevine" | "PlayReady" - used for the printed CEK tree
	drm: 'Widevine' | 'PlayReady' | 'ClearKey';
	pssh?: string;
	// Called only when the vault could not satisfy every KID
	licence: () => Promise<KeyContainerLike[]>;
	// print the key tree (default true)
	print?: boolean;
}

/**
 * Resolve content keys for a PSSH, preferring the vaults.
 *
 * 1. Parse KIDs from the PSSH.
 * 2. Ask the vault chain (local vaults first).
 * 3. If anything is still missing, call the licence server.
 * 4. Push every new key back into the writable vaults.
 */
export async function resolveKeys(opts: DrmResolveOptions): Promise<KeyContainerLike[]> {
	const { service, drm, pssh, licence } = opts;
	const vaults = getVaults(service);
	const kids = extractKids(pssh);

	let cached: KeyContainerLike[] = [];
	let sources = new Map<string, string>();

	if (vaults.length && kids.length) {
		const hits = await vaults.getKeys(kids);
		cached = [...hits.values()].map((h) => ({ kid: h.kid, key: h.key }));
		sources = new Map([...hits.values()].map((h) => [h.kid, h.from ?? 'vault']));
	}

	const missing = kids.filter((k) => !sources.has(k));
	const allCached = kids.length > 0 && missing.length === 0;

	let keys: KeyContainerLike[] = cached;
	if (!allCached) {
		const fresh = await licence();
		const merged = new Map<string, string>(cached.map((c) => [normaliseKid(c.kid), c.key]));
		for (const k of fresh) {
			if (isNullKey(k.key)) continue;
			merged.set(normaliseKid(k.kid), k.key);
		}
		keys = [...merged.entries()].map(([kid, key]) => ({ kid, key }));

		const toPush: KeyPair[] = keys.filter((k) => !sources.has(normaliseKid(k.kid))).map((k) => ({ kid: k.kid, key: k.key }));
		if (vaults.length && toPush.length) await vaults.addKeys(toPush);
	} else {
		console.debug(`All [repr.number]${kids.length}[/] content key(s) served from vault - licence request skipped`);
	}

	if (opts.print !== false && keys.length) {
		const tree = cekTree(
			drm,
			pssh,
			keys.map((k) => ({
				kid: normaliseKid(k.kid),
				key: k.key,
				from: sources.get(normaliseKid(k.kid)),
				trackKid: kids.includes(normaliseKid(k.kid))
			}))
		);
		console.print(new Padding(tree, [0, 5]));
	}

	return keys;
}
