import assert from 'assert';
import fs from 'fs';
import { extractKids, resolveKeys, configureVaults } from '../modules/module.drm-cache';
import { JSONVault, SQLiteVault, normaliseKid } from '../modules/module.vault';

// ── build a real Widevine PSSH box (v0, protobuf payload with two key_ids) ──
function buildWidevinePssh(kids: string[]): string {
	const proto: Buffer[] = [];
	for (const k of kids) proto.push(Buffer.concat([Buffer.from([0x12, 0x10]), Buffer.from(k, 'hex')]));
	const data = Buffer.concat(proto);
	const size = 4 + 4 + 4 + 16 + 4 + data.length;
	const b = Buffer.alloc(size);
	let o = 0;
	b.writeUInt32BE(size, o);
	o += 4;
	b.write('pssh', o, 'ascii');
	o += 4;
	b.writeUInt32BE(0, o);
	o += 4; // version 0 + flags
	Buffer.from('edef8ba979d64acea3c827dcd51d21ed', 'hex').copy(b, o);
	o += 16;
	b.writeUInt32BE(data.length, o);
	o += 4;
	data.copy(b, o);
	return b.toString('base64');
}

// v1 box carries KIDs in the header instead
function buildV1Pssh(kids: string[]): string {
	const size = 4 + 4 + 4 + 16 + 4 + kids.length * 16 + 4;
	const b = Buffer.alloc(size);
	let o = 0;
	b.writeUInt32BE(size, o);
	o += 4;
	b.write('pssh', o, 'ascii');
	o += 4;
	b.writeUInt32BE(0x01000000, o);
	o += 4; // version 1
	Buffer.from('edef8ba979d64acea3c827dcd51d21ed', 'hex').copy(b, o);
	o += 16;
	b.writeUInt32BE(kids.length, o);
	o += 4;
	for (const k of kids) {
		Buffer.from(k, 'hex').copy(b, o);
		o += 16;
	}
	b.writeUInt32BE(0, o);
	return b.toString('base64');
}

const KID_A = '8f2c1a3b4d5e6f708192a3b4c5d6e7f8';
const KID_B = 'aabbccddeeff00112233445566778899';
const KEY_A = '2b7e151628aed2a6abf7158809cf4f3c';
const KEY_B = '0123456789abcdef0123456789abcdef';

(async () => {
	// 1 - PSSH parsing
	assert.deepStrictEqual(extractKids(buildWidevinePssh([KID_A, KID_B])), [KID_A, KID_B]);
	assert.deepStrictEqual(extractKids(buildV1Pssh([KID_A])), [KID_A]);
	assert.deepStrictEqual(extractKids(undefined), []);
	assert.deepStrictEqual(extractKids('not-base64!!'), []);
	console.log('✓ PSSH KID extraction (v0 protobuf, v1 header, bad input)');

	// 2 - JSON vault round-trip
	const f = '/tmp/kv-test.json';
	if (fs.existsSync(f)) fs.unlinkSync(f);
	const v = new JSONVault('test', f);
	assert.strictEqual(await v.addKeys('crunchyroll', [{ kid: KID_A, key: KEY_A }]), 1);
	assert.strictEqual(await v.addKeys('crunchyroll', [{ kid: KID_A, key: KEY_A }]), 0, 'duplicate must not re-add');
	assert.strictEqual(await v.getKey(KID_A, 'crunchyroll'), KEY_A);
	assert.strictEqual(await v.getKey(KID_A.toUpperCase(), 'CRUNCHYROLL'), KEY_A, 'case-insensitive');
	assert.strictEqual(await v.getKey(KID_B, 'crunchyroll'), undefined);
	assert.strictEqual(await v.addKeys('crunchyroll', [{ kid: KID_B, key: '0'.repeat(32) }]), 0, 'null key rejected');
	console.log('✓ JSON vault: insert, dedupe, case-insensitive lookup, null-key rejection');

	// 3 - SQLite vault (skipped when node:sqlite is unavailable)
	const dbf = '/tmp/kv-test.db';
	if (fs.existsSync(dbf)) fs.unlinkSync(dbf);
	const sv = new SQLiteVault('sqlite', dbf);
	const added = await sv.addKeys('crunchyroll', [{ kid: KID_A, key: KEY_A }]);
	if (added > 0) {
		assert.strictEqual(await sv.getKey(KID_A, 'crunchyroll'), KEY_A);
		console.log('✓ SQLite vault round-trip');
	} else {
		console.log('- SQLite vault skipped (node:sqlite needs Node >= 22.5; running ' + process.version + ')');
	}

	// 4 - resolveKeys: licence on miss, vault on hit
	configureVaults([{ type: 'JSON', name: 'Local JSON', path: f }], '/', true);
	const pssh = buildWidevinePssh([KID_A, KID_B]);
	let licenceCalls = 0;
	const licence = async () => {
		licenceCalls++;
		return [
			{ kid: KID_A, key: KEY_A },
			{ kid: KID_B, key: KEY_B }
		];
	};

	const first = await resolveKeys({ service: 'crunchyroll', drm: 'Widevine', pssh, licence, print: false });
	assert.strictEqual(licenceCalls, 1, 'KID_B was unknown -> licence required');
	assert.strictEqual(first.length, 2);

	const second = await resolveKeys({ service: 'crunchyroll', drm: 'Widevine', pssh, licence, print: false });
	assert.strictEqual(licenceCalls, 1, 'second call must be served entirely from the vault');
	assert.deepStrictEqual(second.map((k) => normaliseKid(k.kid)).sort(), [KID_A, KID_B].sort());
	console.log('✓ resolveKeys: licence fetched once, second run fully vault-served (licence skipped)');

	// 5 - vault disabled -> always hit the licence server
	configureVaults([{ type: 'JSON', name: 'Local JSON', path: f }], '/', false);
	await resolveKeys({ service: 'crunchyroll', drm: 'Widevine', pssh, licence, print: false });
	assert.strictEqual(licenceCalls, 2, 'disabled vaults must bypass the cache');
	console.log('✓ enabled:false bypasses vaults');

	console.log('\nAll vault tests passed.');
})();
