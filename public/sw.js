const VERSION = 'v5';
const SHELL_CACHE = `indexframe-shell-${VERSION}`;
const DATA_CACHE = `indexframe-data-${VERSION}`;
const PREVIEW_CACHE = `indexframe-previews-${VERSION}`;
const OFFLINE_ASSET_CACHE = `indexframe-offline-assets-${VERSION}`;
const OFFLINE_LIBRARY_CACHE = `indexframe-offline-libraries-${VERSION}`;
const OFFLINE_META_CACHE = `indexframe-offline-meta-${VERSION}`;
const ACTIVE_CACHES = [
    SHELL_CACHE,
    DATA_CACHE,
    PREVIEW_CACHE,
    OFFLINE_ASSET_CACHE,
    OFFLINE_LIBRARY_CACHE,
    OFFLINE_META_CACHE,
];
const cancelledLibraryJobs = new Set();

const PUBLIC_SHELL = [
    '/login',
    '/manifest.webmanifest',
    '/icons/indexframe.svg',
    '/icons/indexframe-192.png',
    '/icons/indexframe-512.png',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(cache => cache.addAll(PUBLIC_SHELL))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => (
                        key.startsWith('indexframe-')
                        || key.startsWith('eagle-web-')
                    ) && ! ACTIVE_CACHES.includes(key))
                    .map(key => caches.delete(key)),
            ))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', event => {
    const { request } = event;

    if (request.method !== 'GET') {
        return;
    }

    const url = new URL(request.url);

    if (url.origin !== self.location.origin) {
        return;
    }

    if (request.mode === 'navigate') {
        event.respondWith(navigationResponse(request));

        return;
    }

    if (url.pathname.startsWith('/api/')) {
        event.respondWith(apiResponse(request));

        return;
    }

    if (/^\/media\/[^/]+\/[^/]+\/image\/\d+$/.test(url.pathname)) {
        event.respondWith(optimizedImageResponse(request));

        return;
    }

    if (/^\/media\/[^/]+\/[^/]+\/preview$/.test(url.pathname)) {
        event.respondWith(previewResponse(request));

        return;
    }

    if (/^\/media\/[^/]+\/[^/]+\/original$/.test(url.pathname)) {
        event.respondWith(originalResponse(request));

        return;
    }

    if (/^\/media\/[^/]+\/[^/]+\/download$/.test(url.pathname)) {
        event.respondWith(downloadResponse(request));

        return;
    }

    if (
        url.pathname.startsWith('/build/')
        || url.pathname.startsWith('/icons/')
        || url.pathname === '/manifest.webmanifest'
    ) {
        event.respondWith(cacheFirst(request, SHELL_CACHE));
    }
});

self.addEventListener('message', event => {
    const reply = payload => event.ports[0]?.postMessage(payload);
    const type = event.data?.type;

    if (type === 'CACHE_APP_SHELL') {
        event.waitUntil(runMessage(cacheAppShell(), reply, { cached: true }));

        return;
    }

    if (type === 'CHECK_ASSET') {
        event.waitUntil(
            assetIsCached(event.data.url)
                .then(cached => reply({ cached }))
                .catch(error => reply({ error: readableError(error) })),
        );

        return;
    }

    if (type === 'CACHE_ASSET') {
        event.waitUntil(runMessage(cacheOfflineAsset(event.data.urls), reply, { cached: true }));

        return;
    }

    if (type === 'REMOVE_ASSET') {
        event.waitUntil(runMessage(removeOfflineAsset(event.data.urls), reply, { cached: false }));

        return;
    }

    if (type === 'GET_LIBRARY_CACHE_STATUS') {
        event.waitUntil(
            readLibraryStatus(validatedLibrarySlug(event.data.library))
                .then(status => reply({ done: true, status }))
                .catch(error => reply({ error: readableError(error) })),
        );

        return;
    }

    if (type === 'CACHE_LIBRARY') {
        const library = validatedLibrarySlug(event.data.library);
        cancelledLibraryJobs.delete(library);
        event.waitUntil(
            cacheLibrary(library, progress => reply({ progress }))
                .then(status => reply({ done: true, status }))
                .catch(async error => {
                    const status = await readLibraryStatus(library);

                    if (status) {
                        status.state = 'partial';
                        status.updated_at = new Date().toISOString();
                        await writeLibraryStatus(library, status);
                    }

                    if (error?.name === 'LibraryCacheCancelledError') {
                        reply({ done: true, status });

                        return;
                    }

                    reply({ error: readableError(error), status });
                }),
        );

        return;
    }

    if (type === 'CANCEL_LIBRARY_CACHE') {
        const library = validatedLibrarySlug(event.data.library);
        cancelledLibraryJobs.add(library);
        reply({ cancelled: true, done: true });

        return;
    }

    if (type === 'REMOVE_LIBRARY_CACHE') {
        event.waitUntil(
            removeOfflineLibrary(validatedLibrarySlug(event.data.library))
                .then(() => reply({ done: true, removed: true }))
                .catch(error => reply({ error: readableError(error) })),
        );

        return;
    }

    if (type === 'CLEAR_PRIVATE_CACHES') {
        event.waitUntil(runMessage(clearPrivateCaches(), reply, { cleared: true }));
    }
});

async function runMessage(promise, reply, result) {
    try {
        await promise;
        reply({ done: true, ...result });
    } catch (error) {
        reply({ error: readableError(error) });
    }
}

async function cacheAppShell() {
    const cache = await caches.open(SHELL_CACHE);
    const rootResponse = await fetch(new Request('/', { credentials: 'same-origin', cache: 'no-store' }));

    if (! rootResponse.ok || new URL(rootResponse.url).pathname === '/login') {
        throw new Error('Sign in before making the library available offline.');
    }

    await cache.put('/', rootResponse.clone());
    const manifestResponse = await fetch('/build/manifest.json', { cache: 'no-store' });

    if (! manifestResponse.ok) {
        throw new Error('The application bundle could not be cached.');
    }

    const manifest = await manifestResponse.json();
    const assets = new Set(['/build/manifest.json']);

    Object.values(manifest).forEach(entry => {
        if (entry.file) {
            assets.add(`/${entry.file}`);
        }

        (entry.css || []).forEach(file => assets.add(`/${file}`));
        (entry.assets || []).forEach(file => assets.add(`/${file}`));
    });

    await cache.addAll([...assets]);
}

async function navigationResponse(request) {
    try {
        const response = await fetchWithTimeout(request);
        const responsePath = new URL(response.url).pathname;

        if (response.status === 401 || responsePath === '/login') {
            await clearPrivateCaches();
        }

        if (response.ok) {
            const cache = await caches.open(SHELL_CACHE);
            await cache.put(responsePath === '/login' ? '/login' : '/', response.clone());
        }

        return response;
    } catch {
        const cache = await caches.open(SHELL_CACHE);
        const pathname = new URL(request.url).pathname;
        const cached = await cache.match(pathname === '/login' ? '/login' : '/');

        return cached || Response.error();
    }
}

async function apiResponse(request) {
    const cache = await caches.open(DATA_CACHE);

    try {
        const response = await fetchWithTimeout(request);

        if (response.status === 401) {
            await clearPrivateCaches();
        } else if (response.ok) {
            await cache.put(request, response.clone());
            await trimCache(DATA_CACHE, 240);
        }

        return response;
    } catch {
        const cached = await cache.match(request);

        return cached || new Response(JSON.stringify({
            message: 'This view has not been cached for offline use yet.',
        }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}

async function optimizedImageResponse(request) {
    const offlineLibraryCache = await caches.open(OFFLINE_LIBRARY_CACHE);
    const offline = await offlineLibraryCache.match(request);

    if (offline) {
        return offline;
    }

    const requestUrl = new URL(request.url);

    for (const width of [1600, 960, 640]) {
        const candidateUrl = new URL(requestUrl);
        candidateUrl.pathname = candidateUrl.pathname.replace(/\/image\/\d+$/, `/image/${width}`);
        const candidate = await offlineLibraryCache.match(candidateUrl.href);

        if (candidate) {
            return candidate;
        }
    }

    return previewResponse(request);
}

async function previewResponse(request) {
    const offlineCache = await caches.open(OFFLINE_ASSET_CACHE);
    const pinned = await offlineCache.match(request);

    if (pinned) {
        return pinned;
    }

    const cache = await caches.open(PREVIEW_CACHE);
    const cached = await cache.match(request);
    const network = fetch(request)
        .then(async response => {
            if (response.ok) {
                await cache.put(request, response.clone());
                await trimCache(PREVIEW_CACHE, 1200);
            }

            return response;
        });

    if (cached) {
        network.catch(() => null);

        return cached;
    }

    return network;
}

async function originalResponse(request) {
    const cache = await caches.open(OFFLINE_ASSET_CACHE);
    const cached = await cache.match(request.url);

    if (cached) {
        return rangedResponse(cached, request.headers.get('range'));
    }

    return fetch(request);
}

async function downloadResponse(request) {
    try {
        return await fetch(request);
    } catch {
        const originalUrl = request.url.replace(/\/download(?:\?.*)?$/, '/original');
        const cache = await caches.open(OFFLINE_ASSET_CACHE);
        const cached = await cache.match(originalUrl);

        if (! cached) {
            return Response.error();
        }

        return rangedResponse(cached, request.headers.get('range'));
    }
}

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    if (cached) {
        return cached;
    }

    const response = await fetch(request);

    if (response.ok) {
        await cache.put(request, response.clone());
    }

    return response;
}

async function cacheOfflineAsset(urls = []) {
    const cache = await caches.open(OFFLINE_ASSET_CACHE);

    for (const value of urls) {
        const url = validatedAssetUrl(value);
        const response = await fetch(new Request(url, {
            credentials: 'same-origin',
            cache: 'no-store',
        }));

        if (! response.ok) {
            throw new Error(`The asset could not be downloaded (${response.status}).`);
        }

        await cache.put(url, response);
    }
}

async function removeOfflineAsset(urls = []) {
    const cache = await caches.open(OFFLINE_ASSET_CACHE);

    await Promise.all(urls.map(value => cache.delete(validatedAssetUrl(value))));
}

async function assetIsCached(value) {
    const cache = await caches.open(OFFLINE_ASSET_CACHE);

    return Boolean(await cache.match(validatedAssetUrl(value)));
}

async function cacheLibrary(library, reportProgress) {
    await cacheAppShell();
    const dataCache = await caches.open(DATA_CACHE);
    const libraryCache = await caches.open(OFFLINE_LIBRARY_CACHE);
    await cacheAuthenticatedJson('/api/libraries', dataCache);
    await cacheAuthenticatedJson(`/api/libraries/${encodeURIComponent(library)}/folders`, dataCache);
    const previousStatus = await readLibraryStatus(library);
    const status = {
        state: 'caching',
        processed: 0,
        total: previousStatus?.total || 0,
        downloaded_bytes: previousStatus?.downloaded_bytes || 0,
        skipped: 0,
        updated_at: new Date().toISOString(),
    };
    await writeLibraryStatus(library, status);
    reportProgress(status);
    let page = 1;
    let lastPage = 1;
    const activeUrls = new Set();

    do {
        assertLibraryJobContinues(library);
        const manifestUrl = `/api/libraries/${encodeURIComponent(library)}/offline-assets?page=${page}`;
        const response = await fetch(new Request(manifestUrl, {
            credentials: 'same-origin',
            cache: 'no-store',
        }));

        if (! response.ok) {
            throw new Error(`Library metadata could not be downloaded (${response.status}).`);
        }

        const manifest = await response.clone().json();
        await dataCache.put(manifestUrl, response);
        lastPage = manifest.meta.last_page;
        status.total = manifest.meta.total;

        for (let offset = 0; offset < manifest.data.length; offset += 4) {
            assertLibraryJobContinues(library);
            const batch = manifest.data.slice(offset, offset + 4);
            const results = await Promise.all(batch.map(asset => cacheLibraryAsset(asset, libraryCache, activeUrls)));

            for (const result of results) {
                status.processed += 1;
                status.downloaded_bytes += result.downloadedBytes;
                status.skipped += result.skipped ? 1 : 0;
            }

            status.updated_at = new Date().toISOString();
            await writeLibraryStatus(library, status);
            reportProgress({ ...status });
        }

        page += 1;
    } while (page <= lastPage);

    await removeStaleLibraryImages(libraryCache, library, activeUrls);
    status.state = 'complete';
    status.updated_at = new Date().toISOString();
    await writeLibraryStatus(library, status);
    reportProgress({ ...status });

    return status;
}

async function cacheLibraryAsset(asset, cache, activeUrls) {
    const value = asset.offline_url || asset.preview_url;

    try {
        const url = validatedAssetUrl(value);
        activeUrls.add(url);

        return {
            downloadedBytes: await cacheLibraryImage(url, cache),
            skipped: false,
        };
    } catch (error) {
        if (error?.name === 'QuotaExceededError') {
            throw error;
        }

        return { downloadedBytes: 0, skipped: true };
    }
}

async function cacheAuthenticatedJson(url, cache) {
    const request = new Request(url, { credentials: 'same-origin', cache: 'no-store' });
    const response = await fetch(request);

    if (! response.ok) {
        throw new Error(`Offline metadata could not be downloaded (${response.status}).`);
    }

    await cache.put(request, response);
}

async function cacheLibraryImage(value, cache) {
    const url = validatedAssetUrl(value);
    const existing = await cache.match(url);

    if (existing) {
        return 0;
    }

    const response = await fetch(new Request(url, {
        credentials: 'same-origin',
        cache: 'no-store',
    }));

    if (! response.ok) {
        throw new Error(`An optimized image could not be downloaded (${response.status}).`);
    }

    const contentLength = Number(response.headers.get('Content-Length')) || 0;
    await cache.put(url, response);

    return contentLength;
}

async function removeStaleLibraryImages(cache, library, activeUrls) {
    const mediaPrefix = `/media/${encodeURIComponent(library)}/`;
    const keys = await cache.keys();
    const staleKeys = keys.filter(key => {
        const candidate = new URL(key.url);

        return candidate.pathname.startsWith(mediaPrefix) && ! activeUrls.has(candidate.href);
    });
    await Promise.all(staleKeys.map(key => cache.delete(key)));
}

function assertLibraryJobContinues(library) {
    if (! cancelledLibraryJobs.has(library)) {
        return;
    }

    cancelledLibraryJobs.delete(library);
    const error = new Error('Offline library download paused. You can resume it later.');
    error.name = 'LibraryCacheCancelledError';

    throw error;
}

async function readLibraryStatus(library) {
    const cache = await caches.open(OFFLINE_META_CACHE);
    const response = await cache.match(libraryStatusUrl(library));

    return response ? response.json() : null;
}

async function writeLibraryStatus(library, status) {
    const cache = await caches.open(OFFLINE_META_CACHE);
    await cache.put(libraryStatusUrl(library), new Response(JSON.stringify(status), {
        headers: { 'Content-Type': 'application/json' },
    }));
}

function libraryStatusUrl(library) {
    return new URL(`/__eagle-offline-library/${encodeURIComponent(library)}`, self.location.origin).href;
}

async function removeOfflineLibrary(library) {
    const encodedLibrary = encodeURIComponent(library);
    const mediaPrefix = `/media/${encodedLibrary}/`;
    const dataPrefix = `/api/libraries/${encodedLibrary}/`;

    for (const cacheName of [OFFLINE_LIBRARY_CACHE, PREVIEW_CACHE]) {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        await Promise.all(keys
            .filter(key => new URL(key.url).pathname.startsWith(mediaPrefix))
            .map(key => cache.delete(key)));
    }

    const dataCache = await caches.open(DATA_CACHE);
    const dataKeys = await dataCache.keys();
    await Promise.all(dataKeys
        .filter(key => new URL(key.url).pathname.startsWith(dataPrefix))
        .map(key => dataCache.delete(key)));
    const metaCache = await caches.open(OFFLINE_META_CACHE);
    await metaCache.delete(libraryStatusUrl(library));
}

function validatedLibrarySlug(value) {
    if (typeof value !== 'string' || ! /^[a-z0-9][a-z0-9-]{0,120}$/.test(value)) {
        throw new Error('The app refused an invalid library identifier.');
    }

    return value;
}

function validatedAssetUrl(value) {
    const url = new URL(value, self.location.origin);

    if (url.origin !== self.location.origin) {
        throw new Error('The app refused an invalid offline asset URL.');
    }

    if (! /^\/media\/[^/]+\/[^/]+\/(preview|original|image\/\d+)$/.test(url.pathname)) {
        throw new Error('The app refused an invalid offline asset URL.');
    }

    return url.href;
}

async function rangedResponse(response, rangeHeader) {
    if (! rangeHeader) {
        return response;
    }

    const blob = await response.blob();
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);

    if (! match) {
        return response;
    }

    let start = match[1] ? Number(match[1]) : null;
    let end = match[2] ? Number(match[2]) : null;

    if (start === null && end !== null) {
        start = Math.max(0, blob.size - end);
        end = blob.size - 1;
    } else {
        start = start ?? 0;
        end = Math.min(end ?? blob.size - 1, blob.size - 1);
    }

    if (start > end || start >= blob.size) {
        return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${blob.size}` },
        });
    }

    const headers = new Headers(response.headers);
    headers.delete('Content-Encoding');
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Content-Range', `bytes ${start}-${end}/${blob.size}`);

    return new Response(blob.slice(start, end + 1), {
        status: 206,
        statusText: 'Partial Content',
        headers,
    });
}

async function clearPrivateCaches() {
    await Promise.all([
        caches.delete(DATA_CACHE),
        caches.delete(PREVIEW_CACHE),
        caches.delete(OFFLINE_ASSET_CACHE),
        caches.delete(OFFLINE_LIBRARY_CACHE),
        caches.delete(OFFLINE_META_CACHE),
    ]);

    const shell = await caches.open(SHELL_CACHE);
    await shell.delete('/');
}

async function trimCache(cacheName, maximumEntries) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();

    if (keys.length > maximumEntries) {
        await cache.delete(keys[0]);
        await trimCache(cacheName, maximumEntries);
    }
}

async function fetchWithTimeout(request, timeout = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
        return await fetch(request, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

function readableError(error) {
    if (error?.name === 'QuotaExceededError') {
        return 'The browser has reached its offline storage limit. Remove another offline library or individual asset, then resume.';
    }

    return error?.message || 'Offline storage failed.';
}
