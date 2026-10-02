import { HLSCallback } from 'hls-download';
import type { AvailableMuxer } from '../modules/module.args';
import { LanguageItem } from '../modules/module.langsData';

export interface MessageHandler {
	name: string;
	auth: (data: AuthData) => Promise<AuthResponse>;
	version: () => Promise<string>;
	checkToken: () => Promise<CheckTokenResponse>;
	search: (data: SearchData) => Promise<SearchResponse>;
	availableDubCodes: () => Promise<string[]>;
	availableSubCodes: () => Promise<string[]>;
	handleDefault: (name: string) => Promise<any>;
	resolveItems: (data: ResolveItemsData) => Promise<boolean>;
	listEpisodes: (id: string) => Promise<EpisodeListResponse>;
	downloadItem: (data: QueueItem) => void;
	isDownloading: () => Promise<boolean>;
	openFolder: (path: FolderTypes) => void;
	openFile: (data: [FolderTypes, string]) => void;
	openURL: (data: string) => void;
	getQueue: () => Promise<QueueItem[]>;
	removeFromQueue: (index: number) => void;
	clearQueue: () => void;
	setDownloadQueue: (data: boolean) => void;
	getDownloadQueue: () => Promise<boolean>;
}

export type FolderTypes = 'content' | 'config';

export type QueueItem = {
	title: string;
	episode: string;
	fileName: string;
	dlsubs: string[];
	parent: {
		title: string;
		season: string;
	};
	q: number;
	dlVideoOnce: boolean;
	dubLang: string[];
	image: string;
} & ResolveItemsData;

export type ResolveItemsData = {
	id: string;
	dubLang: string[];
	all: boolean;
	but: boolean;
	novids: boolean;
	noaudio: boolean;
	dlVideoOnce: boolean;
	e: string;
	fileName: string;
	q: number;
	dlsubs: string[];
};

export type SearchResponseItem = {
	image: string;
	name: string;
	desc?: string;
	id: string;
	lang?: string[];
	rating: number;
};

export type Episode = {
	e: string;
	lang: string[];
	name: string;
	season: string;
	seasonTitle: string;
	episode: string;
	id: string;
	img: string;
	description: string;
	time: string;
};

export type SearchResponse = ResponseBase<SearchResponseItem[]>;
export type EpisodeListResponse = ResponseBase<Episode[]>;

export type AuthData = { username: string; password: string };
export type SearchData = { search: string; page?: number; 'search-type'?: string; 'search-locale'?: string };
export type DownloadData = {
	hslang?: string;
	id: string;
	e: string;
	dubLang: string[];
	dlsubs: string[];
	fileName: string;
	q: number;
	novids: boolean;
	noaudio: boolean;
	dlVideoOnce: boolean;
};

export type AuthResponse = ResponseBase<undefined>;
export type CheckTokenResponse = ResponseBase<undefined>;

export type ResponseBase<T> =
	| {
			isOk: true;
			value: T;
	  }
	| {
			isOk: false;
			reason: Error;
	  };

export type ProgressData = {
	total: number;
	cur: number;
	percent: number | string;
	time: number;
	downloadSpeed: number;
	bytes: number;
};

export type PossibleMessages = keyof ServiceHandler;

export type DownloadInfo = {
	image: string;
	parent: {
		title: string;
	};
	title: string;
	language: LanguageItem;
	fileName: string;
};

export type ExtendedProgress = {
	progress: ProgressData;
	downloadInfo: DownloadInfo;
};

export type GuiState = {
	setup: boolean;
	services: Record<string, GuiStateService>;
};

export type GuiStateService = {
	queue: QueueItem[];
};
