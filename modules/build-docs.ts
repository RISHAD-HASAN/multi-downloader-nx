import packageJSON from '../package.json';
import fs from 'fs';
import path from 'path';
import { args, groups } from './module.args';

const transformService = (str: Array<'crunchy' | 'hidive' | 'adn' | 'all'>) => {
	const services: string[] = [];
	str.forEach(function (part) {
		switch (part) {
			case 'crunchy':
				services.push('Crunchyroll');
				break;
			case 'hidive':
				services.push('Hidive');
				break;
			case 'adn':
				services.push('AnimationDigitalNetwork');
				break;
			case 'all':
				services.push('All');
				break;
		}
	});
	return services.join(', ');
};

let docs = `# ${packageJSON.name} (v${packageJSON.version})

If you find any bugs in this documentation or in the program itself please report it [over on GitHub](${packageJSON.bugs.url}).

## Legal Warning

This application is not endorsed by or affiliated with *Crunchyroll*, *Hidive* or *AnimationDigitalNetwork*.
This application enables you to download videos for offline viewing which may be forbidden by law in your country.
The usage of this application may also cause a violation of the *Terms of Service* between you and the stream provider.
This tool is not responsible for your actions; please make an informed decision before using this application.

## CLI Options
### Legend
 - \`\${someText}\` shows that you should replace this text with your own
    - e.g. \`--username \${someText}\` -> \`--username Izuco\`
`;

Object.entries(groups).forEach(([key, value]) => {
	docs += `\n### ${value.slice(0, -1)}\n`;

	docs += args
		.filter((a) => a.group === key)
		.map((argument) => {
			return [
				`#### \`${argument.name.length > 1 ? '--' : '-'}${argument.name}\``,
				`| **Service** | **Usage** | **Type** | **Required** | **Alias** | ${argument.choices ? '**Choices** |' : ''} ${argument.default ? '**Default** |' : ''}**cli-default Entry**`,
				`| --- | --- | --- | --- | --- | ${argument.choices ? '--- | ' : ''}${argument.default ? '--- | ' : ''}---| `,
				`| ${transformService(argument.service)} | \`${argument.name.length > 1 ? '--' : '-'}${argument.name} ${argument.usage}\` | \`${argument.type}\` | \`${argument.demandOption ? 'Yes' : 'No'}\`|` +
					` \`${(argument.alias ? `${argument.alias.length > 1 ? '--' : '-'}${argument.alias}` : undefined) ?? 'NaN'}\` |` +
					`${argument.choices ? ` [${argument.choices.map((a) => `\`${a || "''"}\``).join(', ')}] |` : ''}` +
					`${
						argument.default
							? ` \`${
									typeof argument.default === 'object'
										? Array.isArray(argument.default)
											? JSON.stringify(argument.default)
											: (argument.default as any).default
										: argument.default
								}\`|`
							: ''
					}` +
					` ${typeof argument.default === 'object' && !Array.isArray(argument.default) ? `\`${argument.default.name || argument.name}: \`` : '`NaN`'} |`,
				'',
				argument.docDescribe === true ? argument.describe : argument.docDescribe
			].join('\n');
		})
		.join('\n');
});

// Fork-specific sections. They used to be typed straight into the generated
// docs/DOCUMENTATION.md, where every run of `pnpm docs` deleted them - so they
// live here, next to the rest of the generated text.
docs += `
---

## Content Key Vaults

A vault caches \`KID -> CONTENT KEY\` pairs per service. When a title is
re-downloaded - or when another dub or season shares the same keys - aniDL reads
the key from the vault and never contacts the licence server.

Configure in \`config/vaults.yml\`:

\`\`\`yaml
enabled: true
key_vaults:
  - type: SQLite            # requires Node >= 22.5 (built-in node:sqlite)
    name: 'Local Vault'
    path: './config/key_vault.db'

  # - type: JSON            # zero-dependency fallback for older Node
  #   name: 'Local JSON Vault'
  #   path: './config/key_vault.json'

  # - type: API             # remote HTTP vault
  #   name: 'Team Vault'
  #   uri: 'https://vault.example.com/api'
  #   token: 'your-secret-key'
  #   no_push: false        # true = read-only
\`\`\`

Local vaults are always queried before network vaults. Keys obtained from a
licence are written back to every vault that does not set \`no_push: true\`.

The schema matches devine's vaults, so \`path\` can point at an existing
\`key_vault.db\`.

## Console Theming

| Option | Description |
| ------ | ----------- |
| \`--theme <name>\` | \`catppuccin-mocha\` (default), \`dracula\`, \`nord\`, \`gruvbox\`, \`one-dark\`, \`mono\` |
| \`--noColor\` | Disable all colour and styling |

Environment overrides: \`ANIDL_THEME\`, \`ANIDL_NO_COLOR\`, \`ANIDL_LOG_LEVEL\`
(\`debug\`/\`info\`/\`warning\`/\`error\`).
`;

fs.writeFileSync(path.resolve(__dirname, '..', 'docs', 'DOCUMENTATION.md'), docs);
