import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// Import service modules with a valid CLI invocation: Req's constructor parses
// argv, and tests must never reach the network.
(async () => {
	const savedArgs = process.argv;
	process.argv = [...savedArgs, '--service', 'crunchy'];
	try {
		await import('../modules/log'); // initialize the config/logger cycle first
		const { default: streamdl } = await import('../modules/hls-download');

		const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anidl-hls-test-'));
		const key = crypto.randomBytes(16);

		const encrypt = (plain: Buffer, ivNum?: number) => {
			if (ivNum === undefined) return plain;
			const iv = Buffer.alloc(16);
			iv.writeUInt32BE(ivNum, 12);
			const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
			return Buffer.concat([cipher.update(plain), cipher.final()]);
		};

		type ServerOptions = {
			// Segments failing this many times before they succeed (index -> attempts)
			flaky?: (index: number, attempt: number) => boolean;
			// Always fail these segments
			dead?: number[];
			encrypted?: boolean;
			// IV override for the encrypted payload
			ivFor?: (index: number) => number | undefined;
		};

		const makeSegment = (index: number, size: number) => Buffer.alloc(size, (index % 250) + 1);

		const startServer = async (segmentCount: number, options: ServerOptions = {}) => {
			const requests: { path: string; time: number }[] = [];
			const keyRequests: number[] = [];
			const attempts = new Map<number, number>();
			// The first part (index -1) is the EXT-X-MAP init segment
			const segmentSizes = new Map<number, number>();
			for (let i = -1; i < segmentCount; i++) segmentSizes.set(i, 1024 + (((i + 2) * 512) % 4096));
			const server = http.createServer((req, res) => {
				const url = req.url ?? '/';
				requests.push({ path: url, time: Date.now() });
				if (url === '/key') {
					keyRequests.push(Date.now());
					res.writeHead(200, { 'content-type': 'application/octet-stream' });
					res.end(key);
					return;
				}
				const match = /^\/seg\/(-?\d+)$/.exec(url);
				if (!match) {
					res.writeHead(404);
					res.end();
					return;
				}
				const index = Number(match[1]);
				const attempt = (attempts.get(index) ?? 0) + 1;
				attempts.set(index, attempt);
				if (options.dead?.includes(index) || options.flaky?.(index, attempt)) {
					res.writeHead(500, { 'content-type': 'text/plain' });
					res.end('boom');
					return;
				}
				const plain = makeSegment(index, segmentSizes.get(index) as number);
				const body = options.encrypted ? encrypt(plain, options.ivFor ? options.ivFor(index) : undefined) : plain;
				res.writeHead(200, { 'content-type': 'video/mp4' });
				res.end(body);
			});
			await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
			const port = (server.address() as { port: number }).port;
			return {
				url: (p: string) => `http://127.0.0.1:${port}${p}`,
				requests,
				keyRequests,
				segmentSizes,
				close: () => new Promise<void>((resolve) => server.close(() => resolve()))
			};
		};

		const expectedPlain = (sizes: Map<number, number>, from: number, count: number, firstIndex = 0) => {
			const parts: Buffer[] = [];
			for (let i = from; i < from + count; i++) {
				parts.push(makeSegment(i, sizes.get(firstIndex + i) as number));
			}
			return Buffer.concat(parts);
		};

		// Buffers can be megabytes: a plain assert.deepEqual diff would format both
		// sides and can blow up memory, so compare sizes and the first mismatch.
		const assertBytes = (actual: Buffer, expected: Buffer, message: string) => {
			if (actual.length !== expected.length) {
				throw new Error(`${message}: size ${actual.length} != expected ${expected.length}`);
			}
			for (let i = 0; i < actual.length; i++) {
				if (actual[i] !== expected[i]) throw new Error(`${message}: first byte mismatch at offset ${i}`);
			}
		};

		// 1. Parts land on disk in playlist order while transfers overlap
		{
			const count = 30;
			const server = await startServer(count);
			const out = path.join(temp, 'ordered.m4s');
			const progress: number[] = [];
			const result = await new streamdl({
				output: out,
				threads: 8,
				retries: 2,
				timeout: 15000,
				m3u8json: { segments: Array.from({ length: count }, (_, i) => ({ uri: server.url(`/seg/${i}`) })) },
				override: 'y',
				callback: (data: { cur: number }) => progress.push(data.cur)
			}).download();
			assert.equal(result.ok, true);
			assert.equal(fs.existsSync(`${out}.resume`), false, 'a finished download removes its resume marker');
			assertBytes(fs.readFileSync(out), expectedPlain(server.segmentSizes, 0, count), 'parts are written in playlist order');
			assert.equal(progress[progress.length - 1], count, 'the last callback reports every part');
			assert.ok(
				progress.every((v, i) => i === 0 || v >= progress[i - 1]),
				'progress must never go backwards'
			);
			await server.close();
			console.log('✓ parts are written in order, resume marker removed, progress reported');
		}

		// 2. One EXT-X-KEY fetch serves every part
		{
			const count = 25;
			const server = await startServer(count, { encrypted: true, ivFor: (index) => index + 1 });
			const out = path.join(temp, 'encrypted.m4s');
			const result = await new streamdl({
				output: out,
				threads: 10,
				retries: 2,
				timeout: 15000,
				m3u8json: {
					segments: Array.from({ length: count }, (_, i) => ({ uri: server.url(`/seg/${i}`), key: { uri: server.url('/key'), iv: [0, 0, 0, i + 1] } }))
				},
				override: 'y'
			}).download();
			assert.equal(result.ok, true);
			assertBytes(fs.readFileSync(out), expectedPlain(server.segmentSizes, 0, count), 'AES-128 parts decrypt to the original bytes');
			assert.equal(server.keyRequests.length, 1, 'every part sharing a key URI must reuse one key download');
			await server.close();
			console.log('✓ one key download decrypts a whole playlist');
		}

		// 3. Resume keeps the playlist positions (and the implicit IVs) intact
		{
			const count = 24;
			const done = 10;
			const server = await startServer(count, { encrypted: true, ivFor: (index) => index + 1 });
			const out = path.join(temp, 'resume.m4s');
			// The first `done` parts are already on disk, encrypted with their own IVs
			// The downloader stores decrypted parts, so the prefix is plaintext
			const written: Buffer[] = [];
			for (let i = 0; i < done; i++) {
				written.push(makeSegment(i, server.segmentSizes.get(i) as number));
			}
			fs.writeFileSync(out, Buffer.concat(written));
			fs.writeFileSync(`${out}.resume`, JSON.stringify({ completed: done, total: count }));
			const result = await new streamdl({
				output: out,
				threads: 6,
				retries: 2,
				timeout: 15000,
				m3u8json: {
					segments: Array.from({ length: count }, (_, i) => ({ uri: server.url(`/seg/${i}`), key: { uri: server.url('/key'), iv: [0, 0, 0, i + 1] } }))
				},
				override: 'y'
			}).download();
			assert.equal(result.ok, true);
			assert.equal(fs.existsSync(`${out}.resume`), false);
			const requested = server.requests.filter((r) => r.path.startsWith('/seg/')).map((r) => r.path);
			for (let i = 0; i < done; i++) assert.equal(requested.includes(`/seg/${i}`), false, `resumed download must not refetch part ${i + 1}`);
			assert.equal(requested.length, count - done, 'resume fetches exactly the missing parts');
			assertBytes(fs.readFileSync(out), expectedPlain(server.segmentSizes, 0, count), 'the resumed file is complete and in order');
			await server.close();
			console.log('✓ resume fetches only the missing parts and keeps positions');
		}

		// 4. Resuming keeps implicit key IVs absolute: parts 10.. would decrypt with
		// the wrong IV if the client numbered them from the start of the slice.
		{
			const count = 12;
			const done = 5;
			const server = await startServer(count, { encrypted: true, ivFor: (index) => index + 1 });
			const out = path.join(temp, 'implicit-iv.m4s');
			const written: Buffer[] = [];
			for (let i = 0; i < done; i++) {
				written.push(makeSegment(i, server.segmentSizes.get(i) as number));
			}
			fs.writeFileSync(out, Buffer.concat(written));
			fs.writeFileSync(`${out}.resume`, JSON.stringify({ completed: done, total: count }));
			const result = await new streamdl({
				output: out,
				threads: 4,
				retries: 2,
				timeout: 15000,
				m3u8json: {
					segments: Array.from({ length: count }, (_, i) => ({ uri: server.url(`/seg/${i}`), key: { uri: server.url('/key') } }))
				},
				override: 'y'
			}).download();
			assert.equal(result.ok, true);
			assertBytes(fs.readFileSync(out), expectedPlain(server.segmentSizes, 0, count), 'implicit IVs stay absolute after a resume');
			await server.close();
			console.log('✓ implicit key IVs follow the part position, resume included');
		}

		// 5. A dead part aborts the run but keeps a resumable prefix
		{
			const count = 12;
			const dead = 5;
			const server = await startServer(count, { dead: [dead] });
			const out = path.join(temp, 'dead.m4s');
			const result = await new streamdl({
				output: out,
				threads: 4,
				retries: 2,
				timeout: 15000,
				m3u8json: { segments: Array.from({ length: count }, (_, i) => ({ uri: server.url(`/seg/${i}`) })) },
				override: 'y'
			}).download();
			assert.equal(result.ok, false, 'a part that never succeeds fails the download');
			const onDisk = fs.readFileSync(out);
			const prefix = expectedPlain(server.segmentSizes, 0, dead);
			assertBytes(onDisk, prefix, 'only the contiguous prefix in front of the dead part is kept');
			const resume = JSON.parse(fs.readFileSync(`${out}.resume`, 'utf-8'));
			assert.equal(resume.completed, dead, 'the resume marker stops at the contiguous prefix');
			assert.equal(resume.total, count, 'the resume marker counts every part in the playlist');
			assert.equal(resume.bytes, prefix.byteLength, 'the resume marker records the byte count on disk');
			await server.close();
			console.log('✓ a failed part leaves a contiguous, resumable prefix');
		}

		// 6. The init part (EXT-X-MAP) is prepended once and never counted as a part
		{
			const count = 6;
			const server = await startServer(count);
			const out = path.join(temp, 'init.m4s');
			const result = await new streamdl({
				output: out,
				threads: 3,
				retries: 2,
				timeout: 15000,
				m3u8json: {
					segments: [{ uri: server.url('/seg/-1'), map: { uri: server.url('/seg/-1') } }, ...Array.from({ length: count }, (_, i) => ({ uri: server.url(`/seg/${i}`) }))]
				},
				override: 'y'
			}).download();
			assert.equal(result.ok, true);
			// The first playlist entry carries the map and is still a media part itself
			const expected = Buffer.concat([
				makeSegment(-1, server.segmentSizes.get(-1) as number),
				makeSegment(-1, server.segmentSizes.get(-1) as number),
				expectedPlain(server.segmentSizes, 0, count)
			]);
			assertBytes(fs.readFileSync(out), expected, 'the init part comes first, then the media parts');
			const initRequests = server.requests.filter((r) => r.path === '/seg/-1').length;
			assert.equal(initRequests, 2, 'the init segment is downloaded once (once as init, once as the first playlist entry)');
			await server.close();
			console.log('✓ the init part is written once in front of the media parts');
		}

		// 7. A crash mid-write can leave bytes on disk the marker does not cover:
		// resuming must trim them, or every later part would be shifted.
		{
			const count = 12;
			const done = 5;
			const server = await startServer(count);
			const out = path.join(temp, 'trim.m4s');
			const prefix = expectedPlain(server.segmentSizes, 0, done);
			fs.writeFileSync(out, Buffer.concat([prefix, makeSegment(90, 2048)]));
			fs.writeFileSync(`${out}.resume`, JSON.stringify({ completed: done, total: count, bytes: prefix.byteLength }));
			const result = await new streamdl({
				output: out,
				threads: 4,
				retries: 2,
				timeout: 15000,
				m3u8json: { segments: Array.from({ length: count }, (_, i) => ({ uri: server.url(`/seg/${i}`) })) },
				override: 'y'
			}).download();
			assert.equal(result.ok, true);
			assertBytes(fs.readFileSync(out), expectedPlain(server.segmentSizes, 0, count), 'uncommitted trailing bytes are trimmed before the resume appends');
			await server.close();
			console.log('✓ resume trims bytes written after the last committed part');
		}

		fs.rmSync(temp, { recursive: true, force: true });
		console.log('\nAll hls-download tests passed.');
	} finally {
		process.argv = savedArgs;
	}
})();
