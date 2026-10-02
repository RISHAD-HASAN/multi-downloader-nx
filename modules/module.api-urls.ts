// api domains
const domain = {
	cr_www: 'https://www.crunchyroll.com',
	cr_api: 'https://beta-api.crunchyroll.com',
	cr_playback: 'https://cr-play-service.prd.crunchyrollsvc.com',
	cr_license: 'https://cr-license-proxy.prd.crunchyrollsvc.com'
};

export type APIType = {
	// Crunchyroll API
	basic_auth_token: string;
	auth: string;
	me: string;
	profile: string;
	search: string;
	content_cms: string;
	content_music: string;
	browse: string;
	browse_all_series: string;
	streaming_sessions: string;
	drm_widevine: string;
	drm_playready: string;
	// Crunchyroll Bucket
	cms_bucket: string;
	cms_auth: string;
	// Crunchyroll Headers
	crunchyDefUserAgent: string;
	crunchyDefHeader: Record<string, any>;
	crunchyAuthHeader: Record<string, string>;
	crunchyAuthRefreshHeader: Record<string, string>;
};

const api: APIType = {
	//
	//
	// Crunchyroll
	// Crunchyroll API
	basic_auth_token: 'ZXZ4YzVybGN1bnd4cm91YWpmeHI6NkJGWGM1SUk3UWx2Z3NFbzdiVjBuWUNfN1VRLXVlSVM=',
	auth: `${domain.cr_api}/auth/v1/token`,
	me: `${domain.cr_api}/accounts/v1/me`,
	profile: `${domain.cr_api}/accounts/v1/me/profile`,
	search: `${domain.cr_api}/content/v2/discover/search`,
	content_cms: `${domain.cr_api}/content/v2/cms`,
	content_music: `${domain.cr_api}/content/v2/music`,
	browse: `${domain.cr_api}/content/v1/browse`,
	browse_all_series: `${domain.cr_api}/content/v2/discover/browse`,
	streaming_sessions: `${domain.cr_playback}/v1/sessions/streaming`,
	drm_widevine: `https://cr-license-proxy.prd.crunchyrollsvc.com/v1/license/widevine`,
	drm_playready: `https://cr-license-proxy.prd.crunchyrollsvc.com/v1/license/playReady`,
	//
	// Crunchyroll Bucket
	cms_bucket: `${domain.cr_api}/cms/v2`,
	cms_auth: `${domain.cr_api}/index/v2`,
	//
	// Crunchyroll Headers
	crunchyDefUserAgent: 'Crunchyroll/ANDROIDTV/3.70.0_22358 (Android 12; en-US; SHIELD Android TV Build/SR1A.220624.014)',
	crunchyDefHeader: {},
	crunchyAuthHeader: {},
	crunchyAuthRefreshHeader: {}
	//
	//
};

api.crunchyDefHeader = {
	'User-Agent': api.crunchyDefUserAgent,
	'Accept-Encoding': 'gzip',
	Connection: 'Keep-Alive'
};

// set header
api.crunchyAuthHeader = {
	Accept: 'application/json',
	'Accept-Charset': 'UTF-8',
	'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
	'Request-Type': 'SignIn',
	...api.crunchyDefHeader
};

// set header
api.crunchyAuthRefreshHeader = {
	Accept: 'application/json',
	'Accept-Charset': 'UTF-8',
	'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
	...api.crunchyDefHeader
};

export { domain, api };
