import assert from 'node:assert/strict';
import http from 'node:http';

// The pool has to follow --partsize: undici queues requests past the pool size
// per origin, so the old hard-coded 16 silently capped every --partsize above 16.
(async () => {
	const savedArgs = process.argv;
	process.argv = [...savedArgs, '--service', 'crunchy', '--partsize', '30'];
	try {
		await import('../modules/log'); // initialize the config/logger cycle first
		const { Req, connectionCount } = await import('../modules/module.fetch');

		// Pure sizing: 2 tracks worth of workers plus API headroom, floored at the
		// old default and capped so a joke --partsize cannot exhaust the process.
		assert.equal(connectionCount(undefined), 16, 'no partsize keeps the old pool size');
		assert.equal(connectionCount(0), 16);
		assert.equal(connectionCount(-5), 16);
		assert.equal(connectionCount(Number.NaN), 16);
		assert.equal(connectionCount(1), 16, 'small partsize stays at the floor');
		assert.equal(connectionCount(10), 24, 'two tracks of ten workers fit');
		assert.equal(connectionCount(20), 44, 'default partsize gets a pool it can actually use');
		assert.equal(connectionCount(30), 64);
		assert.equal(connectionCount(500), 128, 'the pool is capped');
		console.log('✓ the connection pool is sized from --partsize');

		// Live proof: 30 concurrent segment requests against a server that only
		// answers once enough of them are in flight. A pool capped at 16 can never
		// reach the gate, so it times out at 16 and fails the assertion.
		const WANTED = 20;
		const REQUESTS = 30;
		let active = 0;
		let maxActive = 0;
		let releaseGate!: () => void;
		const gate = new Promise<void>((resolve) => {
			releaseGate = resolve;
		});
		const server = http.createServer((req, res) => {
			active++;
			maxActive = Math.max(maxActive, active);
			if (active >= WANTED) releaseGate();
			const finish = () => {
				active--;
				res.writeHead(200, { 'content-type': 'application/octet-stream' });
				res.end(Buffer.alloc(1024));
			};
			// Fallback so a capped pool cannot hang the test suite
			const timer = setTimeout(finish, 1500);
			void gate.then(() => {
				clearTimeout(timer);
				finish();
			});
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const port = (server.address() as { port: number }).port;

		const req = new Req();
		const url = `http://127.0.0.1:${port}/part`;
		await Promise.all(
			Array.from({ length: REQUESTS }, async (_, i) => {
				const res = await req.getData(`${url}?i=${i}`, { silent: true });
				assert.ok(res.ok, `request ${i} failed`);
				await res.res?.arrayBuffer();
			})
		);
		server.close();
		assert.ok(maxActive >= WANTED, `expected at least ${WANTED} segment requests in flight, saw ${maxActive} (a pool capped at 16 can never get there)`);
		console.log(`✓ ${maxActive} segment requests were in flight at once (pool: ${connectionCount(30)})`);
		console.log('\nAll fetch pool tests passed.');
	} finally {
		process.argv = savedArgs;
	}
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
