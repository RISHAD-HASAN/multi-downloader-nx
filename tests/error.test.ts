// Diagnostics for transport failures: unwrap the cause chain undici hides behind
// "TypeError: fetch failed" and turn known codes into advice.
import assert from 'assert';
import { describeError, networkHint } from '../modules/module.error';

// Real undici errors, not hand-built ones
(async () => {
	const cases: Array<{ url: string; label: string; expectCode: RegExp }> = [
		{ url: 'https://no-such-host.invalid/x', label: 'DNS failure', expectCode: /ENOTFOUND|EAI_AGAIN/ },
		{ url: 'http://127.0.0.1:45999/x', label: 'connection refused', expectCode: /ECONNREFUSED/ }
	];

	for (const c of cases) {
		let caught: unknown;
		try {
			await fetch(c.url);
		} catch (e) {
			caught = e;
		}
		assert.ok(caught, `${c.label}: expected a throw`);
		const desc = describeError(caught);

		// the bare message must no longer be all the user sees
		assert.notStrictEqual(desc, 'TypeError: fetch failed', `${c.label}: cause was not unwrapped`);
		assert.ok(c.expectCode.test(desc), `${c.label}: missing code in "${desc}"`);
		assert.ok(networkHint(caught), `${c.label}: no hint produced`);
		console.log(`✓ ${c.label}: ${desc}`);
		console.log(`    hint: ${networkHint(caught)}`);
	}

	// The shape a failed download produces
	const undiciLike = Object.assign(new TypeError('fetch failed'), {
		cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
	});
	const d = describeError(undiciLike);
	assert.ok(d.includes('ECONNRESET'), `expected ECONNRESET in "${d}"`);
	const hint = networkHint(undiciLike);
	assert.ok(hint && /partsize/i.test(hint), 'reset should advise lowering --partsize');
	console.log(`✓ ECONNRESET: ${d}`);
	console.log(`    hint: ${hint}`);

	// timeouts get the throttling hint too
	const timeout = Object.assign(new TypeError('fetch failed'), {
		cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' })
	});
	assert.ok(/partsize/i.test(networkHint(timeout) ?? ''), 'timeout should advise lowering --partsize');
	console.log(`✓ UND_ERR_CONNECT_TIMEOUT: ${describeError(timeout)}`);

	// TLS interception is called out distinctly
	const tls = Object.assign(new TypeError('fetch failed'), {
		cause: Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' })
	});
	assert.ok(/TLS/i.test(networkHint(tls) ?? ''), 'expected a TLS-specific hint');
	console.log(`✓ CERT_HAS_EXPIRED: ${describeError(tls)}`);

	// Degenerate inputs must never throw or print "undefined"
	for (const bad of [undefined, null, '', 'plain string', new Error(), {}, 0]) {
		const out = describeError(bad);
		assert.strictEqual(typeof out, 'string');
		assert.ok(out.length > 0, `empty description for ${JSON.stringify(bad)}`);
		assert.ok(!out.includes('undefined'), `"undefined" leaked for ${JSON.stringify(bad)}: ${out}`);
	}
	// an Error with no message used to produce a blank failure line
	assert.ok(describeError(new Error()).length > 0);
	console.log('✓ degenerate inputs never yield empty/"undefined" text');

	// non-network errors must not produce a misleading hint
	assert.strictEqual(networkHint(new Error('shaka exited with code 1')), undefined);
	console.log('✓ non-network errors produce no hint');

	console.log('\nAll error-diagnostic tests passed.');
})();
