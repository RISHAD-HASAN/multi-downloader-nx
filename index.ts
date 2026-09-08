import { console } from './modules/log';
import { appArgv, overrideArguments } from './modules/module.app-args';
import * as yamlCfg from './modules/module.cfg-loader';
import { makeCommand, addToArchive } from './modules/module.downloadArchive';
import Crunchy from './crunchy';
import Hidive from './hidive';
import ADN from './adn';
import packageJson from './package.json';
import { printBanner, setTheme, theme } from './modules/module.console';
import { configureVaults } from './modules/module.drm-cache';
import { parseUrl } from './modules/module.url';

import update from './modules/module.updater';

const SERVICES: Record<string, any> = {
	crunchy: Crunchy,
	hidive: Hidive,
	adn: ADN
};

/**
 * Resolve `-u/--url` into a service + target argument.
 * Ported from the Yurasubs fork (modules/module.url.ts).
 */
const applyUrl = (argv: any): boolean => {
	if (!argv.url) return true;
	const parsed = parseUrl(argv.url);
	if (!parsed) {
		console.error(`Could not recognise the URL [repr.url]${argv.url}[/]`);
		console.error('Supported: crunchyroll.com, hidive.com, animationdigitalnetwork.fr/.com, adn.fr');
		return false;
	}

	argv.service = parsed.service;
	switch (parsed.type) {
		case 'series':
			argv.srz = parsed.id;
			argv.series = parsed.id;
			break;
		case 'season':
			argv.s = parsed.id;
			break;
		case 'episode':
			argv.e = parsed.id;
			break;
		case 'movieListing':
			argv.movieListing = parsed.id;
			break;
		case 'extid':
			argv.extid = parsed.id;
			break;
	}

	console.info(`URL resolved -> service [cyan]${parsed.service}[/], ${parsed.type} [repr.number]${parsed.id}[/]`);
	return true;
};

(async () => {
	const cfg = yamlCfg.loadCfg();
	const argv = appArgv(cfg.cli);

	// Console presentation (ported from unshackle): palette + colour toggle
	if (argv.noColor) theme.enabled = false;
	else if (argv.theme) setTheme(argv.theme);

	// unshackle-style banner (skipped in GUI mode)
	if (process.env.isGUI !== 'true') printBanner(packageJson.version);

	if (argv.debug) console.level = 'debug';

	// Content key vaults (ported from unshackle) - see config/vaults.yml
	const vaultCfg = yamlCfg.loadVaultCfg();
	configureVaults(vaultCfg.key_vaults, yamlCfg.workingDir, vaultCfg.enabled !== false);

	if (!applyUrl(argv)) return;

	if (!argv.skipUpdate) await update(argv.update);

	if (argv.all && argv.but) {
		console.error('--all and --but exclude each other!');
		return;
	}

	if (argv.addArchive) {
		if (argv.service === 'crunchy') {
			if (argv.s === undefined && argv.series === undefined) return console.error('`-s` or `--srz` not found');
			if (argv.s && argv.series) return console.error('Both `-s` and `--srz` found');
			addToArchive(
				{
					service: 'crunchy',
					type: argv.s === undefined ? 'srz' : 's'
				},
				(argv.s === undefined ? argv.series : argv.s) as string
			);
			console.info('Added %s to the downloadArchive list', argv.s === undefined ? argv.series : argv.s);
		} else if (argv.service === 'hidive') {
			if (argv.s === undefined) return console.error('`-s` not found');
			addToArchive(
				{
					service: 'hidive',
					//type: argv.s === undefined ? 'srz' : 's'
					type: 's'
				},
				(argv.s === undefined ? argv.series : argv.s) as string
			);
			console.info('Added %s to the downloadArchive list', argv.s === undefined ? argv.series : argv.s);
		}
	} else if (argv.downloadArchive && argv.service) {
		const ids = makeCommand(argv.service);
		for (const id of ids) {
			overrideArguments(cfg.cli, id);
			const Service = SERVICES[argv.service];
			if (!Service) {
				console.error('Unknown service:', argv.service);
				process.exit(1);
			}

			const service = new Service();
			await service.cli();
		}
	} else if (argv.service) {
		const Service = SERVICES[argv.service];
		if (!Service) {
			console.error('Unknown service:', argv.service);
			process.exit(1);
		}

		const service = new Service();
		await service.cli();
	}
})();
