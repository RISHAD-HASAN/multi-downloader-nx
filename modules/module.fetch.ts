import * as yamlCfg from './module.cfg-loader';
import * as yargs from './module.app-args';
import { console } from './log';
import { argvC } from './module.app-args';
import { Agent, ProxyAgent, fetch, RequestInit } from 'undici';
import { describeError } from './module.error';

// The pool has to hold as many connections as the downloader actually wants.
// A segment download opens one connection per worker and a video and an audio
// transfer can be in flight at the same time, so the pool follows --partsize.
// It used to be pinned at 16, and undici queues requests past the pool size per
// origin - which silently made every --partsize above 16 a no-op.
const MIN_CONNECTIONS = 16;
// Past this the extra sockets cost file descriptors and CDN-side risk without
// buying measurable throughput.
const MAX_CONNECTIONS = 128;

/** Connections the pool needs for a given --partsize (both tracks + API headroom). */
export const connectionCount = (partsize?: number): number => {
	const requested = Number(partsize);
	if (!Number.isFinite(requested) || requested < 1) return MIN_CONNECTIONS;
	return Math.max(MIN_CONNECTIONS, Math.min(Math.floor(requested) * 2 + 4, MAX_CONNECTIONS));
};

// One agent per pool size: every Req in the process shares a pool for its size,
// so keep-alive survives across service instances.
const http1Agents = new Map<number, Agent>();
const getHttp1Agent = (connections: number): Agent => {
	let agent = http1Agents.get(connections);
	if (!agent) {
		agent = new Agent({
			connections,
			connect: { ALPNProtocols: ['http/1.1'] },
			allowH2: false
		});
		http1Agents.set(connections, agent);
	}
	return agent;
};

// One ProxyAgent per proxy URI and pool size, reused across requests: a fresh
// agent per request would throw away its connection pool and lose keep-alive on
// every segment download.
const proxyAgents = new Map<string, ProxyAgent>();
const getProxyAgent = (uri: string, connections: number): ProxyAgent => {
	const key = `${connections}|${uri}`;
	let agent = proxyAgents.get(key);
	if (!agent) {
		agent = new ProxyAgent({
			uri,
			connections,
			connect: { ALPNProtocols: ['http/1.1'] },
			allowH2: false
		});
		proxyAgents.set(key, agent);
	}
	return agent;
};

export type FetchParams = Partial<RequestInit & CustomParams>;

export type Params = {
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	headers?: Record<string, string>;
	body?: BodyInit | undefined;
	binary?: boolean;
	followRedirect?: 'follow' | 'error' | 'manual';
};

type CustomParams = {
	useProxy: boolean;
	// Suppress console output; the caller reports the failure itself
	silent: boolean;
};

export type GetDataResponse = {
	ok: boolean;
	res?: Response;
	headers?: Record<string, string>;
	error?: {
		name: string;
	} & TypeError & {
			res?: Response;
		};
};

// function hasDisplay(): boolean {
// 	if (process.platform === 'linux') {
// 		return !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;
// 	}
// 	// Win and Mac true by default
// 	return true;
// }

// req
export type ProxyCheck = { ok: true } | { ok: false; kind: 'socks' | 'unsupported' | 'malformed'; detail: string };

/**
 * Classify a `--proxy` value.
 *
 * Undici can only drive an HTTP/HTTPS proxy. A socks:// URI parses fine, so it
 * used to be accepted by the URL check and then dropped again per request with a
 * generic "invalid Proxy URL" warning - which left a geo-unblocking run going
 * out over the real connection while looking configured.
 */
export const checkProxyUrl = (uri: string): ProxyCheck => {
	let parsed: URL;
	try {
		parsed = new URL(uri);
	} catch {
		return { ok: false, kind: 'malformed', detail: `${uri} is not a valid URL` };
	}

	if (['socks4:', 'socks5:', 'socks5h:'].includes(parsed.protocol)) {
		return { ok: false, kind: 'socks', detail: `${uri} is a SOCKS proxy, which the HTTP client cannot use` };
	}

	if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
		return { ok: false, kind: 'unsupported', detail: `${uri} is not an http:// or https:// proxy URL` };
	}

	return { ok: true };
};

// Every Req in the process sees the same --proxy, so report a bad one once.
const reportedProxies = new Set<string>();

const reportProxyIssue = (uri: string, lines: string[]) => {
	if (reportedProxies.has(uri)) return;
	reportedProxies.add(uri);
	for (const line of lines) console.error(line);
};

export class Req {
	private debug: boolean;
	// Size of this client's HTTP/1.1 pool (see connectionCount)
	private connections: number;
	// Resolved once: a bad proxy is reported once per run, not once per request
	private proxy?: ProxyAgent;
	public argv: typeof argvC;

	constructor() {
		const cfg = yamlCfg.loadCfg();
		this.argv = yargs.appArgv(cfg.cli, process.env.isGUI ? true : false);
		this.debug = this.argv.debug ?? false;
		this.connections = connectionCount(this.argv.partsize);
		this.proxy = this.resolveProxy();
	}

	/**
	 * Build the proxy agent for `--proxy`, or undefined when the setting cannot
	 * be honoured. Callers fall back to a direct connection, so every rejection
	 * here has to be loud: a silently unproxied request defeats the point of
	 * using a proxy in the first place.
	 */
	private resolveProxy(): ProxyAgent | undefined {
		const uri = this.argv.proxy;
		if (!uri) return undefined;

		const check = checkProxyUrl(uri);
		if (check.ok) return getProxyAgent(uri, this.connections);

		const lines = [`[Fetch] --proxy ${check.detail}; traffic will NOT be proxied.`];
		if (check.kind === 'socks') lines.push('[Fetch] Use an http:// or https:// proxy, or bridge SOCKS to HTTP locally (privoxy, ...).');
		reportProxyIssue(uri, lines);
		return undefined;
	}

	async getData(durl: string, params: Partial<RequestInit & CustomParams> = {}): Promise<GetDataResponse> {
		const options: RequestInit = {
			method: params.method ? params.method : 'GET'
		};
		if (params.headers) {
			options.headers = params.headers;
		}
		if (params.body) {
			options.body = params.body;
		}
		if (typeof params.redirect == 'string') {
			options.redirect = params.redirect;
		}

		// Proxy Handler
		let dispatcher: Agent | ProxyAgent = getHttp1Agent(this.connections);
		if ((params.useProxy || this.argv.proxyAll) && this.proxy) {
			dispatcher = this.proxy;
		}

		// Debug
		if (this.debug) {
			console.debug('[DEBUG] FETCH OPTIONS:');
			console.debug(options);
		}

		try {
			const res = await fetch(durl, { ...options, dispatcher });
			if (!res.ok && !params.silent) {
				console.error(`${res.status}: ${res.statusText}`);
				const body = await res.text();
				const docTitle = body.match(/<title>(.*)<\/title>/);
				if (body && docTitle) {
					// if (docTitle[1] === 'Just a moment...' && durl.includes('crunchyroll') && hasDisplay()) {
					// 	console.warn('Cloudflare triggered, trying to get cookies...');

					// 	const { page } = await connect({
					// 		headless: false,
					// 		turnstile: true
					// 	});

					// 	await page.goto('https://www.crunchyroll.com/', {
					// 		waitUntil: 'networkidle2'
					// 	});

					// 	await page.waitForRequest('https://www.crunchyroll.com/auth/v1/token');

					// 	const cookies = await page.cookies();

					// 	await page.close();

					// 	params.headers = {
					// 		...params.headers,
					// 		Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
					// 		'Set-Cookie': cookies.map((c) => `${c.name}=${c.value}`).join('; ')
					// 	};

					// 	(params as any).headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

					// 	return await this.getData(durl, params);
					// } else {
					// 	console.error(docTitle[1]);
					// }

					console.error(docTitle[1]);
				} else {
					console.error(body);
				}
			}
			return {
				ok: res.ok,
				res: res as any,
				headers: params.headers as Record<string, string>
			};
		} catch (_error) {
			const error = _error as {
				name: string;
			} & TypeError & {
					res: Response;
				};
			// undici hides the real reason in a nested cause chain
			if (!params.silent) {
				if (error.res && error.res.status && error.res.statusText) {
					console.error(`${error.name} ${error.res.status}: ${error.res.statusText}`);
				} else {
					console.error(describeError(error));
				}
			}
			if (error.res && !params.silent) {
				const body = await error.res.text();
				const docTitle = body.match(/<title>(.*)<\/title>/);
				if (body && docTitle) {
					console.error(docTitle[1]);
				}
			}
			return {
				ok: false,
				error
			};
		}
	}
}
