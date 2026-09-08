// Node's fetch reports almost every transport problem as the same opaque
// "TypeError: fetch failed" and buries the real reason in a nested cause chain.
// These unwrap it and turn the common codes into something actionable.

// Unwrap an error (and undici's nested `cause` chain) into one readable line.
export function describeError(err: unknown): string {
	if (err === undefined || err === null) return 'Unknown error';
	if (typeof err === 'string') return err.trim() || 'Unknown error';
	if (typeof err !== 'object') return String(err);

	const e = err as any;
	const parts: string[] = [];

	const head = [e.name && e.name !== 'Error' ? e.name : undefined, e.message || undefined].filter(Boolean).join(': ');
	if (head) parts.push(head);

	// undici nests the real socket error under .cause (sometimes several deep)
	let cause = e.cause;
	let depth = 0;
	while (cause && depth++ < 5) {
		const c = cause as any;
		const code = c.code ? `[${c.code}] ` : '';
		const msg = c.message || (typeof c === 'string' ? c : '');
		const line = `${code}${msg}`.trim();
		if (line && !parts.includes(line)) parts.push(line);
		cause = c.cause;
	}

	if (e.code && !parts.some((p) => p.includes(String(e.code)))) parts.unshift(`[${e.code}]`);

	// HTTP-style errors carried on the response
	if (e.res?.status) parts.unshift(`HTTP ${e.res.status}${e.res.statusText ? ` ${e.res.statusText}` : ''}`);

	const out = parts.filter(Boolean).join(' -> ');
	if (out) return out;
	// last resort: something object-shaped with no name/message/cause
	try {
		const json = JSON.stringify(err);
		if (json && json !== '{}') return json;
	} catch {
		/* circular */
	}
	return 'Unknown error';
}

// Extract every error code present in the cause chain
export function errorCodes(err: unknown): string[] {
	const codes: string[] = [];
	let cur: any = err;
	let depth = 0;
	while (cur && depth++ < 6) {
		if (cur.code) codes.push(String(cur.code));
		cur = cur.cause;
	}
	return codes;
}

/**
 * Turn common transport failures into advice. Returns undefined when the error
 * is not a recognised network problem.
 */
export function networkHint(err: unknown): string | undefined {
	const codes = errorCodes(err).map((c) => c.toUpperCase());
	const text = `${describeError(err)}`.toUpperCase();
	const has = (...needles: string[]) => needles.some((n) => codes.includes(n) || text.includes(n));

	if (has('ENOTFOUND', 'EAI_AGAIN')) {
		return 'DNS lookup failed - your connection dropped, or a VPN/DNS change broke name resolution.';
	}
	if (has('ECONNREFUSED')) {
		return 'Connection refused - check any proxy/VPN settings.';
	}
	if (has('CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT')) {
		return 'TLS certificate rejected - usually a corporate proxy, antivirus HTTPS scanning, or a wrong system clock.';
	}
	if (has('UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT')) {
		return 'The server stopped responding - the CDN is likely throttling you. Lower --partsize (try 5-10) and retry in a few minutes.';
	}
	if (has('ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET', 'SOCKETERROR', 'OTHER SIDE CLOSED')) {
		return 'The CDN closed the connection mid-transfer - usually rate limiting from too many parallel parts. Lower --partsize (try 5-10) and retry in a few minutes.';
	}
	if (has('FETCH FAILED')) {
		return 'Network request failed - connection lost or the CDN refused further requests. Lower --partsize and retry in a few minutes.';
	}
	return undefined;
}
