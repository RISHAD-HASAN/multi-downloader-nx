// Guards the packaged-build config manifest.
// `modules/build.ts` copies config files into the build output one by one.
// When `config/vaults.yml` was added it was not included, so packaged binaries
// silently shipped without key vaults. This test fails if any shipped config
// file in `config/` is missing from build.ts's copy list.
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..');
const buildSrc = fs.readFileSync(path.join(root, 'modules', 'build.ts'), 'utf8');

// Config files that are generated or user/session specific are never shipped.
const NOT_SHIPPED = new Set([
	'bin-path.yml' // regenerated per-platform by build.ts
]);
const RUNTIME_ONLY = /(_token|_sess|_profile|guistate|\.user)\./;

const configFiles = fs
	.readdirSync(path.join(root, 'config'))
	.filter((f) => f.endsWith('.yml'))
	.filter((f) => !RUNTIME_ONLY.test(f))
	.filter((f) => !NOT_SHIPPED.has(f));

assert.ok(configFiles.length > 0, 'no config files discovered');

const missing = configFiles.filter((f) => !buildSrc.includes(`./config/${f}`));
assert.deepStrictEqual(missing, [], `modules/build.ts does not ship these config files (packaged builds would lose them): ${missing.join(', ')}`);
console.log(`✓ build.ts ships all ${configFiles.length} config file(s): ${configFiles.join(', ')}`);

// bin-path.yml must still be generated for the target platform
assert.ok(/bin-path\.yml/.test(buildSrc), 'build.ts no longer generates bin-path.yml');
console.log('✓ build.ts still generates bin-path.yml per platform');

// The vault fallback must exist so an older/broken build still caches keys
const cfgLoader = fs.readFileSync(path.join(root, 'modules', 'module.cfg-loader.ts'), 'utf8');
assert.ok(/key_vaults:\s*\[\{\s*type:\s*'SQLite'/.test(cfgLoader), 'module.cfg-loader.ts lost its default SQLite vault fallback');
console.log('✓ cfg-loader falls back to a local SQLite vault when vaults.yml is absent');

// node:sqlite must stay a plain literal require so esbuild keeps it external
const vault = fs.readFileSync(path.join(root, 'modules', 'module.vault.ts'), 'utf8');
assert.ok(vault.includes("require('node:sqlite')"), 'module.vault.ts must use a literal require("node:sqlite") so esbuild leaves it external');
console.log('✓ node:sqlite is required literally (survives esbuild bundling)');

console.log('\nAll build-manifest tests passed.');
