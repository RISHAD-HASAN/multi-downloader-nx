import assert from 'node:assert/strict';
import http from 'node:http';

// No SOCKS proxy is listening anywhere in this test: if a request were routed
// through one it would fail to connect instead of reaching the local server.
const PROXY = 'socks5://127.0.0.1:1080';

(async () => {
	const savedArgs = process.argv;
	process.argv = [...savedArgs, '--service', 'crunchy', '--proxy', PROXY];
	try {
		await import('../modules/log'); // initialize the config/logger cycle first
		const { Req, checkProxyUrl } = await import('../modules/module.fetch');

		// The classification is pure, so every shape can be checked at once.
		for (const uri of ['socks5://127.0.0.1:1080', 'socks4://127.0.0.1:1080', 'socks5h://127.0.0.1:1080']) {
			const check = checkProxyUrl(uri);
			assert.equal(check.ok, false, `${uri} must be rejected`);
			if (!check.ok) assert.equal(check.kind, 'socks');
		}
		for (const uri of ['http://127.0.0.1:8080', 'https://user:pass@127.0.0.1:8080', 'http://127.0.0.1']) {
			assert.equal(checkProxyUrl(uri).ok, true, `${uri} must be accepted`);
		}
		for (const uri of ['ftp://127.0.0.1:21', 'file:///tmp/x', 'not-a-url', 'http://', 'http://host:99999']) {
			const check = checkProxyUrl(uri);
			assert.equal(check.ok, false, `${uri} must be rejected`);
			if (!check.ok) assert.notEqual(check.kind, 'socks');
		}
		console.log('✓ SOCKS and unusable proxy URLs are rejected, http/https accepted');

		// A Req built with a SOCKS --proxy must end up with no proxy at all rather
		// than quietly pretending to be configured.
		const req = new Req();
		assert.equal((req as unknown as { proxy?: unknown }).proxy, undefined, 'a SOCKS proxy must not be installed as an agent');

		// And traffic must still work - it just goes out directly, which is what
		// the error message has to say.
		const server = http.createServer((_rq, res) => {
			res.writeHead(200, { 'content-type': 'application/octet-stream' });
			res.end(Buffer.alloc(64));
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const port = (server.address() as { port: number }).port;
		try {
			const res = await req.getData(`http://127.0.0.1:${port}/part`, { useProxy: true, silent: true });
			assert.ok(res.ok, 'a request must not be routed through an unusable proxy');
		} finally {
			server.close();
		}
		console.log('✓ requests fall back to a direct connection instead of failing');

		console.log('\nAll proxy tests passed.');
	} finally {
		process.argv = savedArgs;
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
