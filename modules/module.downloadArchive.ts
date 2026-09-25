import { console } from './log';
import * as path from 'path';
import * as fs from 'fs';
import { ArgvType } from './module.app-args';
import { workingDir } from './module.cfg-loader';

export const archiveFile = path.join(workingDir, 'config', 'archive.json');

export type ItemType = {
	id: string;
	already: string[];
}[];

export type DataType = {
	hidive: {
		s: ItemType;
	};
	adn: {
		s: ItemType;
	};
	crunchy: {
		srz: ItemType;
		s: ItemType;
	};
};

const addToArchive = (
	kind:
		| {
				service: 'crunchy';
				type: 's' | 'srz';
		  }
		| {
				service: 'hidive';
				type: 's';
		  }
		| {
				service: 'adn';
				type: 's';
		  },
	ID: string
) => {
	const data = loadData();

	if (Object.prototype.hasOwnProperty.call(data, kind.service)) {
		const items = kind.service === 'crunchy' ? data[kind.service][kind.type] : data[kind.service][kind.type];
		if (items.findIndex((a) => a.id === ID) >= 0)
			// Prevent duplicate
			return;
		items.push({
			id: ID,
			already: []
		});
		(data as any)[kind.service][kind.type] = items;
	} else {
		if (kind.service === 'crunchy') {
			data['crunchy'] = {
				s: ([] as ItemType).concat(
					kind.type === 's'
						? {
								id: ID,
								already: [] as string[]
							}
						: []
				),
				srz: ([] as ItemType).concat(
					kind.type === 'srz'
						? {
								id: ID,
								already: [] as string[]
							}
						: []
				)
			};
		} else if (kind.service === 'adn') {
			data['adn'] = {
				s: [
					{
						id: ID,
						already: []
					}
				]
			};
		} else {
			data['hidive'] = {
				s: [
					{
						id: ID,
						already: []
					}
				]
			};
		}
	}
	fs.writeFileSync(archiveFile, JSON.stringify(data, null, 4));
};

const downloaded = (
	kind:
		| {
				service: 'crunchy';
				type: 's' | 'srz';
		  }
		| {
				service: 'hidive';
				type: 's';
		  }
		| {
				service: 'adn';
				type: 's';
		  },
	ID: string,
	episode: string[]
) => {
	let data = loadData();
	if (
		!Object.prototype.hasOwnProperty.call(data, kind.service) ||
		!Object.prototype.hasOwnProperty.call(data[kind.service], kind.type) ||
		!Object.prototype.hasOwnProperty.call((data as any)[kind.service][kind.type], ID)
	) {
		addToArchive(kind, ID);
		data = loadData(); // Load updated version
	}

	const archivedata = kind.service == 'crunchy' ? data[kind.service][kind.type] : data[kind.service][kind.type];
	const alreadyData = archivedata.find((a) => a.id === ID)?.already;
	for (const ep of episode) {
		if (alreadyData?.includes(ep)) continue;
		alreadyData?.push(ep);
	}
	fs.writeFileSync(archiveFile, JSON.stringify(data, null, 4));
};

const makeCommand = (service: 'crunchy' | 'hidive' | 'adn'): Partial<ArgvType>[] => {
	const data = loadData();
	const ret: Partial<ArgvType>[] = [];
	const kind = data[service];
	if (!kind) return ret;
	for (const type of Object.keys(kind)) {
		const item = kind[type as 's']; // 'srz' is also possible but will be ignored for the compiler
		item.forEach((i) =>
			ret.push({
				but: true,
				all: false,
				service,
				e: i.already.join(','),
				...(type === 's'
					? {
							s: i.id,
							series: undefined
						}
					: {
							series: i.id,
							s: undefined
						})
			})
		);
	}
	return ret;
};

const loadData = (): DataType => {
	if (fs.existsSync(archiveFile)) {
		try {
			const parsed = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid archive data');
			return parsed as DataType;
		} catch {
			console.warn('[Archive] Corrupt archive.json; preserving it and starting a new archive.');
			try {
				const backupBase = `${archiveFile}.corrupt.${Date.now()}`;
				let backup = backupBase;
				for (let index = 1; fs.existsSync(backup); index++) backup = `${backupBase}.${index}`;
				fs.renameSync(archiveFile, backup);
			} catch (error) {
				console.error('[Archive] Could not back up the corrupt archive:', error);
				throw error; // never overwrite an archive that could not be preserved
			}
		}
	}
	return {} as DataType;
};

export { addToArchive, downloaded, makeCommand };
