import { console } from './modules/log';
import { appArgv, overrideArguments } from './modules/module.app-args';
import * as yamlCfg from './modules/module.cfg-loader';
import { makeCommand, addToArchive } from './modules/module.downloadArchive';
import Crunchy from './crunchy';
import packageJson from './package.json';
import { printBanner } from './modules/module.console';
import { setTheme, theme } from './modules/module.rich';
import { configureVaults } from './modules/module.drm-cache';
import { parseUrl } from './modules/module.url';

import update from './modules/module.updater';

// -u/--url: work out the service and which id to set from the URL.
const applyUrl = (argv: any): boolean => {
	if (!argv.url) return true;
	const parsed = parseUrl(argv.url);
	if (!parsed) {
		console.error(`Could not recognise the URL [repr.url]${argv.url}[/]`);
		console.error('Supported: crunchyroll.com');
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

	// palette / colour
	if (argv.noColor) theme.enabled = false;
	else if (argv.theme) setTheme(argv.theme);

	// banner (skipped in GUI mode)
	if (process.env.isGUI !== 'true') printBanner(packageJson.version);

	if (argv.debug) console.level = 'debug';

	// key vaults, see config/vaults.yml
	const vaultCfg = yamlCfg.loadVaultCfg();
	configureVaults(vaultCfg.key_vaults, yamlCfg.workingDir, vaultCfg.enabled !== false);

	if (!applyUrl(argv)) return;

	if (!argv.skipUpdate) await update(argv.update);

	if (argv.all && argv.but) {
		console.error('--all and --but exclude each other!');
		return;
	}

	if (argv.addArchive) {
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
	} else if (argv.downloadArchive) {
		for (const id of makeCommand()) {
			overrideArguments(cfg.cli, id);
			await new Crunchy().cli();
		}
	} else if (argv.service) {
		await new Crunchy().cli();
	}
})();
