/**
 * AIHub Browser — curated ad, tracker and telemetry domain list.
 *
 * Deliberately domain-based rather than a full filter-syntax engine: matching a
 * registrable domain is O(labels) with no regex backtracking, costs nothing on
 * the request path, and cannot mis-fire on a URL that merely *looks* like an ad
 * path. The trade-off is that first-party-disguised ads slip through — worth it
 * for a blocker that never breaks a checkout page.
 *
 * Curation rules used here:
 *   - Ad exchanges, ad servers, and audience/identity brokers: blocked.
 *   - Pure analytics/session-replay/attribution: blocked.
 *   - Consent-management (OneTrust, Cookiebot) and CDNs: NOT blocked — removing
 *     them leaves sites stuck behind a banner that never resolves.
 *   - Payment, auth, captcha and error-reporting hosts: NOT blocked.
 */

/** Ad exchanges, ad servers, SSPs and DSPs. */
const ADS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com',
  'googletagservices.com', 'partner.googleadservices.com', '2mdn.net',
  'amazon-adsystem.com', 'adnxs.com', 'adnxs-simple.com', 'rubiconproject.com', 'pubmatic.com',
  'openx.net', 'openx.com', 'adsrvr.org', 'casalemedia.com', 'criteo.com', 'criteo.net',
  '33across.com', 'sharethrough.com', 'smartadserver.com', 'sascdn.com', 'teads.tv',
  'indexww.com', 'adform.net', 'adformdsp.net', 'bidswitch.net', 'yieldmo.com', 'media.net',
  'mgid.com', 'revcontent.com', 'zemanta.com', 'taboola.com', 'taboolasyndication.com',
  'outbrain.com', 'zergnet.com', 'contentexchange.me', 'plista.com',
  'lijit.com', 'sovrn.com', 'gumgum.com', 'districtm.io', 'spotxchange.com', 'spotx.tv',
  'tremorhub.com', 'unrulymedia.com', 'fwmrm.net', 'springserve.com', 'aniview.com',
  'connatix.com', 'playwire.com', 'primis.tech', 'vidoomy.com', 'sitescout.com',
  'flashtalking.com', 'serving-sys.com', 'adroll.com', 'perfectaudience.com', 'mathtag.com',
  'simpli.fi', 'turn.com', 'adotmob.com', 'adkernel.com', 'adtelligent.com', 'admixer.net',
  'go.affec.tv', 'stickyadstv.com', 'themoneytizer.com', 'adman.gr', 'adhigh.net',
  'adsterra.com', 'propellerads.com', 'popads.net', 'popcash.net', 'adcash.com',
  'exoclick.com', 'juicyads.com', 'trafficjunky.net', 'hilltopads.net', 'clickadu.com',
  'onclickmega.com', 'onclasrv.com', 'bidvertiser.com', 'infolinks.com', 'adblade.com',
  'yieldlab.net', 'improvedigital.com', 'emxdgt.com', 'gammassp.com', 'nativo.com',
  'ad-delivery.net', 'adsafeprotected.com', 'doubleverify.com', 'moatads.com',
]

/** Analytics, session replay, product telemetry and attribution. */
const TRACKERS = [
  'google-analytics.com', 'analytics.google.com', 'googletagmanager.com',
  'scorecardresearch.com', 'quantserve.com', 'quantcount.com', 'comscore.com',
  'imrworldwide.com', 'chartbeat.com', 'chartbeat.net', 'parsely.com', 'parse.ly',
  'hotjar.com', 'hotjar.io', 'mouseflow.com', 'fullstory.com', 'crazyegg.com',
  'luckyorange.com', 'inspectlet.com', 'smartlook.com', 'clarity.ms',
  'mixpanel.com', 'amplitude.com', 'segment.com', 'segment.io', 'heap.io', 'heapanalytics.com',
  'kissmetrics.com', 'statcounter.com', 'histats.com', 'clicky.com', 'getclicky.com',
  'matomo.cloud', 'plausible.io', 'mc.yandex.ru', 'yandex-metrica.com', 'top-fwz1.mail.ru',
  'branch.io', 'appsflyer.com', 'adjust.com', 'kochava.com', 'singular.net', 'tenjin.io',
  'permutive.com', 'krxd.net', 'bluekai.com', 'demdex.net', 'omtrdc.net', '2o7.net',
  'everesttech.net', 'exelator.com', 'rlcdn.com', 'agkn.com', 'tapad.com', 'crwdcntrl.net',
  'addthis.com', 'sharethis.com', 'po.st', 'newrelic-analytics.com',
  'connect.facebook.net', 'pixel.facebook.com', 'analytics.tiktok.com', 'ads.tiktok.com',
  'ads-twitter.com', 'analytics.twitter.com', 'static.ads-twitter.com',
  'ads.linkedin.com', 'px.ads.linkedin.com', 'tr.snapchat.com', 'sc-static.net',
  'ads.pinterest.com', 'analytics.pinterest.com', 'bat.bing.com', 'ads.yahoo.com',
  'analytics.yahoo.com', 'sp.analytics.yahoo.com', 'geo.yahoo.com',
  'app-measurement.com', 'firebase-settings.crashlytics.com', 'braze.com', 'iterable.com',
  'customer.io', 'intercomcdn-telemetry.com', 'pendo.io', 'quantummetric.com',
  'contentsquare.net', 'decibelinsight.net', 'glassboxdigital.io', 'logrocket.io',
  'mparticle.com', 'tealiumiq.com', 'ensighten.com', 'krux.net', 'lytics.io',
  'nr-data.net', 'optimizely.com', 'vwo.com', 'visualwebsiteoptimizer.com',
]

/**
 * Every blocked registrable domain, lowercase, deduplicated.
 * A Set gives O(1) lookups as the matcher walks a hostname's parent domains.
 */
export const DEFAULT_BLOCKLIST: ReadonlySet<string> = new Set(
  [...ADS, ...TRACKERS].map(d => d.toLowerCase()),
)

export const BLOCKLIST_SIZE = DEFAULT_BLOCKLIST.size
