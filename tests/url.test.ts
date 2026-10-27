import assert from 'node:assert/strict';
// log initializes the shared config/logger cycle in the same order as the CLI.
import '../modules/log';
import { parseUrl } from '../modules/module.url';

const expect = (url: string, service: string, type: string, id: string) => {
	const parsed = parseUrl(url);
	assert.ok(parsed, `expected ${url} to be recognised`);
	assert.equal(parsed.service, service, `service for ${url}`);
	assert.equal(parsed.type, type, `type for ${url}`);
	assert.equal(parsed.id, id, `id for ${url}`);
};

(async () => {
	// Crunchyroll: the locale prefix has to be stripped before anything matches.
	expect('https://www.crunchyroll.com/series/GY5P48XKY/frieren', 'crunchy', 'series', 'GY5P48XKY');
	expect('https://www.crunchyroll.com/en/series/GY5P48XKY/frieren', 'crunchy', 'series', 'GY5P48XKY');
	expect('https://www.crunchyroll.com/fr/series/GY5P48XKY/frieren', 'crunchy', 'series', 'GY5P48XKY');
	expect('https://www.crunchyroll.com/es-419/series/GY5P48XKY/frieren', 'crunchy', 'series', 'GY5P48XKY');
	expect('https://www.crunchyroll.com/pt-br/series/GY5P48XKY/frieren', 'crunchy', 'series', 'GY5P48XKY');
	expect('https://www.crunchyroll.com/watch/GJWU2VKKK/episode-1', 'crunchy', 'episode', 'GJWU2VKKK');
	expect('https://www.crunchyroll.com/fr/watch/GJWU2VKKK/ep-1', 'crunchy', 'episode', 'GJWU2VKKK');
	expect('https://www.crunchyroll.com/season/GY5P48XKY/s1', 'crunchy', 'season', 'GY5P48XKY');
	expect('https://www.crunchyroll.com/movie_listing/GY5P48XKY/movies', 'crunchy', 'movieListing', 'GY5P48XKY');
	expect('https://www.crunchyroll.com/movie/GY5P48XKY/a-movie', 'crunchy', 'movieListing', 'GY5P48XKY');
	// Legacy episode URLs end in a numeric external id.
	expect('https://www.crunchyroll.com/frieren/episode-1-the-journey-1234567', 'crunchy', 'extid', '1234567');
	expect('crunchyroll.com/series/GY5P48XKY/frieren', 'crunchy', 'series', 'GY5P48XKY');
	console.log('✓ Crunchyroll series, season, episode, movie and legacy URLs resolve');

	// HiDive
	expect('https://www.hidive.com/series/12345', 'hidive', 'series', '12345');
	expect('https://www.hidive.com/tv/12345', 'hidive', 'series', '12345');
	expect('https://www.hidive.com/season/777', 'hidive', 'season', '777');
	expect('https://www.hidive.com/episode/999', 'hidive', 'episode', '999');
	expect('https://www.hidive.com/stream/some-show/999', 'hidive', 'episode', '999');
	console.log('✓ HiDive series, season and episode URLs resolve');

	// ADN: every domain the service answers on, with and without a slug.
	expect('https://animationdigitalnetwork.fr/video/1234-slug', 'adn', 'season', '1234');
	expect('https://animationdigitalnetwork.com/video/1234', 'adn', 'season', '1234');
	expect('https://adn.fr/video/1234', 'adn', 'season', '1234');
	expect('https://animationdigitalnetwork.fr/show/55', 'adn', 'season', '55');
	console.log('✓ AnimationDigitalNetwork video and show URLs resolve');

	// Unrecognised input must be reported, never guessed at.
	for (const bad of ['', '   ', 'not a url', 'https://example.com/series/GY5P48XKY', 'https://crunchyroll.com/', 'https://www.hidive.com/', 'https://adn.fr/']) {
		assert.equal(parseUrl(bad), undefined, `expected ${JSON.stringify(bad)} to be rejected`);
	}
	assert.equal(parseUrl(undefined as unknown as string), undefined);
	console.log('✓ unknown hosts and empty input are rejected instead of guessed');

	// The original URL is kept verbatim for error messages.
	const original = parseUrl('https://www.crunchyroll.com/series/GY5P48XKY/frieren');
	assert.equal(original?.originalUrl, 'https://www.crunchyroll.com/series/GY5P48XKY/frieren');
	console.log('✓ the original URL survives parsing');

	console.log('\nAll URL tests passed.');
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
