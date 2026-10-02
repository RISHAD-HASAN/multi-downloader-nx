import * as yamlCfg from './module.cfg-loader';
import * as yargs from './module.app-args';
import { console } from './log';
import { argvC } from './module.app-args';
import { Agent, ProxyAgent, fetch, RequestInit } from 'undici';
import { describeError } from './module.error';

const http1Agent = new Agent({
	connections: 16,
	connect: { ALPNProtocols: ['http/1.1'] },
	allowH2: false
});

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

type GetDataResponse = {
	ok: boolean;
	res?: Response;
	headers?: Record<string, string>;
	error?: {
		name: string;
	} & TypeError & {
			res?: Response;
		};
};

// req
export class Req {
	private debug: boolean;
	public argv: typeof argvC;

	constructor() {
		const cfg = yamlCfg.loadCfg();
		this.argv = yargs.appArgv(cfg.cli, process.env.isGUI ? true : false);
		this.debug = this.argv.debug ?? false;
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
		let dispatcher: Agent | ProxyAgent = http1Agent;
		const validProxy = this.argv.proxy ? this.isValidProxyUrl(this.argv.proxy) : false;
		if ((params.useProxy || this.argv.proxyAll) && this.argv.proxy && validProxy) {
			dispatcher = new ProxyAgent({
				uri: this.argv.proxy,
				connections: 16,
				connect: { ALPNProtocols: ['http/1.1'] },
				allowH2: false
			});
		} else if ((params.useProxy || this.argv.proxyAll) && this.argv.proxy && !validProxy) {
			console.warn('[Fetch] Provided invalid Proxy URL, not proxying traffic.');
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

	private isValidProxyUrl(proxyUrl: string): boolean {
		try {
			if (!proxyUrl.match(/^(https?|socks4|socks5):\/\//)) {
				return false;
			}

			const url = new URL(proxyUrl);

			if (!url.hostname) return false;

			if (!['http:', 'https:'].includes(url.protocol)) {
				return false;
			}

			if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535)) {
				return false;
			}

			return true;
		} catch {
			return false;
		}
	}
}
