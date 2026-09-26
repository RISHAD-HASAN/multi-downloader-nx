// End-to-end DUAL tag check: the real downloadMediaList() for one episode with two
// dubs (Japanese + English) against a stubbed network. The tag only reaches a
// filename through the ${audio} variable, so both halves are covered: it lands in
// the name when the template asks for it, and the run says so when it cannot.

import assert from 'node:assert/strict';
import path from 'node:path';

// Any argument keeps commander from printing --help and exiting on import
process.argv = [...process.argv, '--service', 'crunchy'];

const MPD = (audioLang: string) => `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT23M53S" minBufferTime="PT2S">
<Period>
<AdaptationSet mimeType="video/mp4" segmentAlignment="true" contentType="video">
<Representation id="v1" bandwidth="10160000" codecs="avc1.640028" width="1920" height="1080" frameRate="24000/1001">
<SegmentTemplate timescale="1000" duration="6000" initialization="v1/init.mp4" media="v1/seg-$Number$.m4s" startNumber="1"/>
</Representation>
</AdaptationSet>
<AdaptationSet mimeType="audio/mp4" contentType="audio" lang="${audioLang}">
<Representation id="a1" bandwidth="199000" codecs="mp4a.40.2" audioSamplingRate="48000">
<SegmentTemplate timescale="1000" duration="6000" initialization="a1/init.mp4" media="a1/seg-$Number$.m4s" startNumber="1"/>
</Representation>
</AdaptationSet>
</Period>
</MPD>`;

const response = (data: unknown) => ({
	ok: true,
	res: {
		status: 200,
		headers: { get: () => null },
		json: async () => data,
		text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
		arrayBuffer: async () => new ArrayBuffer(0)
	}
});

const missing = { ok: false, res: undefined, error: { res: { status: 404, statusText: 'Not Found' } } };

const playStream = (audioLocale: string, guid: string) => ({
	assetId: `ASSET-${guid}`,
	audioLocale,
	bifs: `bifs-${guid}`,
	burnedInLocale: '',
	captions: {},
	hardSubs: {},
	playbackType: 'dash',
	session: { renewSeconds: 300 },
	subtitles: {},
	token: `token-${guid}`,
	url: `https://cdn.test/manifest.${audioLocale === 'en-US' ? 'eng' : 'jpn'}.urlset/${guid}.mpd?playbackGuid=pg-${guid}&guid=${guid}`,
	versions: []
});

const mediaIdOf = (url: string) => /\/v3\/([^/]+)\//.exec(url)?.[1] ?? 'unknown';

// Stubbed Crunchyroll API + CDN: the video/audio play endpoints answer for the
// version GUID in the URL, the DASH manifests are minimal but real.
const fakeReq = {
	async getData(url: string) {
		if (url.includes('/accounts/v1/me')) return response({ external_id: 'ext-1', username: 'stub' });
		if (url.includes('/subs/v1/subscriptions/')) return response({ items: [{ benefit: 'offline_viewing' }] });
		if (url.includes('/v3/') && (url.includes('/tv/android_tv/') || url.includes('/android/phone/') || url.includes('/android/tablet/'))) {
			const id = mediaIdOf(url);
			return response(playStream(id.includes('ENUS') ? 'en-US' : 'ja-JP', id));
		}
		if (url.includes('/v1/token/')) return { ok: true, res: undefined };
		if (url.startsWith('https://cdn.test/')) return response(MPD(url.includes('ENUS') ? 'en' : 'ja'));
		return missing;
	}
};

const episode = (langs: { jpn: unknown; eng: unknown }) => ({
	data: [
		{
			mediaId: 'GUID_JAJP',
			lang: langs.jpn,
			playback: 'https://cr-play-service.prd.crunchyrollsvc.com/v3/GUID_JAJP/tv/android_tv/play?queue=0',
			versions: [{ audio_locale: 'ja-JP', guid: 'GUID_JAJP', is_premium_only: false, media_guid: 'MG', original: true, season_guid: 'SG', variant: '' }],
			isSubbed: true,
			isDubbed: false,
			durationMs: 1_433_000
		},
		{
			mediaId: 'GUID_ENUS',
			lang: langs.eng,
			playback: 'https://cr-play-service.prd.crunchyrollsvc.com/v3/GUID_ENUS/tv/android_tv/play?queue=0',
			versions: [{ audio_locale: 'en-US', guid: 'GUID_ENUS', is_premium_only: false, media_guid: 'MG', original: false, season_guid: 'SG', variant: '' }],
			isSubbed: false,
			isDubbed: true,
			durationMs: 1_433_000
		}
	],
	seriesTitle: 'Smoking Behind the Supermarket with You',
	seasonTitle: 'Smoking Behind the Supermarket with You',
	episodeNumber: '8',
	episodeTitle: 'Searching Behind the Supermarket with You',
	seasonID: 'SEASON',
	season: 1,
	showID: 'SHOW',
	e: 'E8',
	image: ''
});

async function main() {
	const [{ default: hlsDownload }, langsData, { default: Crunchy }, log] = await Promise.all([
		import('../modules/hls-download'),
		import('../modules/module.langsData'),
		import('../crunchy'),
		import('../modules/log')
	]);

	// Segment transfers and decryption binaries are out of scope offline; the
	// stubbed manifests are not encrypted, so nothing is written to disk.
	(hlsDownload.prototype as any).download = async () => ({ ok: true, parts: [] });

	// Collect the user-facing notices without hiding them from the terminal
	const notices: string[] = [];
	const info = log.console.info.bind(log.console);
	const warn = log.console.warn.bind(log.console);
	(log.console as any).info = (message: string) => (notices.push(String(message)), info(message));
	(log.console as any).warn = (message: string) => (notices.push(String(message)), warn(message));

	class TestCrunchy extends Crunchy {
		protected cdmAvailable(): boolean {
			return true;
		}
	}

	const create = () => {
		const crunchy: any = new TestCrunchy(false);
		crunchy.cfg = {
			bin: { ffmpeg: '/bin/true', mkvmerge: '/bin/true', mp4decrypt: '/bin/true', shaka: '/bin/true' },
			dir: { content: path.join(process.cwd(), 'videos') + path.sep, trash: '', fonts: '', config: '' },
			cli: {},
			gui: {}
		};
		crunchy.token = { access_token: 'stub' };
		crunchy.cmsToken = { cms: { token: 'stub' } };
		crunchy.locale = 'en-US';
		crunchy.req = fakeReq;
		crunchy.refreshToken = async () => {};
		return crunchy;
	};

	const options = (fileName: string) => ({
		hslang: 'none',
		cstream: false,
		vstream: 'androidtv',
		astream: 'android',
		novids: false,
		noaudio: false,
		x: 1,
		q: 0,
		fileName,
		numbers: 2,
		partsize: 4,
		timeout: 10,
		waittime: 0,
		fsRetryTime: 1,
		dlsubs: ['none'],
		skipsubs: true,
		skipMuxOnSubFail: false,
		mp4: false,
		override: [],
		videoTitle: '',
		force: 'Y',
		chapters: false,
		nocleanup: false,
		dlVideoOnce: true,
		ccTag: 'cc'
	});

	const langs = {
		jpn: langsData.languages.find((l) => l.code === 'jpn')!,
		eng: langsData.languages.find((l) => l.code === 'eng')!
	};

	// template with ${audio}: tag lands in the name
	const withTag = await create().downloadMediaList(
		episode(langs),
		options('${seriesTitle}.S${season}E${episode}.${title}.${height}p.CR.WEB.DL.${audio}AAC2.0.H.264.S3NKU') as any
	);
	assert.deepEqual(
		withTag.data.filter((file: any) => file.type === 'Audio').map((file: any) => file.lang.code),
		['jpn', 'eng'],
		'both dubs must be recorded as completed audio tracks'
	);
	assert.ok(withTag.fileName.includes('.CR.WEB.DL.DUAL.AAC2.0.'), `the DUAL tag is missing from ${withTag.fileName}`);
	assert.ok(
		notices.some((line) => line.startsWith('Audio: jpn + eng - DUAL tag added')),
		`the added tag must be reported: ${notices.join(' | ')}`
	);
	console.log('✓ two completed dubs add the DUAL tag through ${audio}');

	// template without ${audio}: the run reports the skipped tag
	notices.length = 0;
	const withoutTag = await create().downloadMediaList(episode(langs), options('${seriesTitle}.S${season}E${episode}.${title}.${height}p.CR.WEB.DL.AAC2.0.H.264.S3NKU') as any);
	assert.deepEqual(
		withoutTag.data.filter((file: any) => file.type === 'Audio').map((file: any) => file.lang.code),
		['jpn', 'eng'],
		'both dubs are completed here too - the tag is missing because of the template'
	);
	assert.ok(!withoutTag.fileName.includes('DUAL'), `no tag can be placed in ${withoutTag.fileName}`);
	assert.ok(
		notices.some((line) => line.includes('${audio}') && line.includes('jpn + eng')),
		`the skipped tag must be explained: ${notices.join(' | ')}`
	);
	console.log('✓ a template without ${audio} reports the skipped DUAL tag');

	console.log('\nAll Crunchyroll DUAL tag tests passed.');
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
