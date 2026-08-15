import {
    ArchiveRestore,
    Camera,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Clock3,
    CloudCheck,
    CloudDownload,
    Copy,
    Download,
    ExternalLink,
    FileQuestion,
    Film,
    Folder,
    FolderOpen,
    Grid3X3,
    Image as ImageIcon,
    LibraryBig,
    Link as LinkIcon,
    LoaderCircle,
    LogOut,
    Menu,
    Plus,
    RefreshCw,
    Search,
    Shuffle,
    Star,
    Tags,
    Trash2,
    Upload,
    Wifi,
    WifiOff,
    X,
} from 'lucide-react';
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

async function sendServiceWorkerMessage(message, { onProgress = null, timeout = 300000 } = {}) {
    if (! ('serviceWorker' in navigator)) {
        throw new Error('Offline storage needs HTTPS and a browser with service worker support.');
    }

    const registration = await navigator.serviceWorker.ready;
    const serviceWorker = navigator.serviceWorker.controller || registration.active;

    if (! serviceWorker) {
        throw new Error('Offline storage is still starting. Try again in a moment.');
    }

    return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = window.setTimeout(() => reject(new Error('Offline storage took too long to respond.')), timeout);

        channel.port1.onmessage = event => {
            if (event.data?.progress) {
                onProgress?.(event.data.progress);

                return;
            }

            window.clearTimeout(timer);

            if (event.data?.error) {
                reject(new Error(event.data.error));

                return;
            }

            resolve(event.data);
        };

        serviceWorker.postMessage(message, [channel.port2]);
    });
}

async function clearOfflineData() {
    if (! ('serviceWorker' in navigator)) {
        return;
    }

    try {
        await sendServiceWorkerMessage({ type: 'CLEAR_PRIVATE_CACHES' }, { timeout: 10000 });
    } catch {
        const cacheKeys = await caches.keys();
        const privateCachePrefixes = [
            'indexframe-data-',
            'indexframe-previews-',
            'indexframe-offline-assets-',
            'indexframe-offline-libraries-',
            'indexframe-offline-meta-',
            'eagle-web-data-',
            'eagle-web-previews-',
            'eagle-web-offline-assets-',
            'eagle-web-offline-libraries-',
            'eagle-web-offline-meta-',
        ];
        await Promise.all(
            cacheKeys
                .filter(key => privateCachePrefixes.some(prefix => key.startsWith(prefix)))
                .map(key => caches.delete(key)),
        );

        const shellKey = cacheKeys.find(key => (
            key.startsWith('indexframe-shell-')
            || key.startsWith('eagle-web-shell-')
        ));

        if (shellKey) {
            const shell = await caches.open(shellKey);
            await shell.delete('/');
        }
    }
}

function useOnlineStatus() {
    const [online, setOnline] = useState(navigator.onLine);

    useEffect(() => {
        const handleOnline = () => setOnline(true);
        const handleOffline = () => setOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    return online;
}

async function api(path, options = {}) {
    let response;

    try {
        response = await fetch(path, {
            credentials: 'same-origin',
            headers: {
                Accept: 'application/json',
                'X-CSRF-TOKEN': csrfToken,
                ...options.headers,
            },
            ...options,
        });
    } catch {
        throw new Error(navigator.onLine
            ? 'The library could not reach the server.'
            : 'This view has not been cached for offline use yet.');
    }

    if (response.status === 401) {
        window.location.assign('/login');

        return null;
    }

    const data = response.status === 204 ? null : await response.json().catch(() => null);

    if (! response.ok) {
        const validationMessage = data?.errors ? Object.values(data.errors).flat()[0] : null;
        throw new Error(validationMessage || data?.message || 'Something went wrong.');
    }

    return data;
}

async function copyText(text) {
    if (! navigator.clipboard?.writeText) {
        throw new Error('Text copying needs HTTPS and clipboard access.');
    }

    await navigator.clipboard.writeText(text);
}

function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (! blob) {
                reject(new Error('The browser could not create a PNG image.'));

                return;
            }

            resolve(blob);
        }, 'image/png');
    });
}

async function copyPngBlob(blob) {
    if (! navigator.clipboard?.write || ! window.ClipboardItem) {
        throw new Error('Image copying is not supported in this browser.');
    }

    await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': Promise.resolve(blob) }),
    ]);
}

async function loadImageSource(blob) {
    if (window.createImageBitmap) {
        return window.createImageBitmap(blob);
    }

    const objectUrl = URL.createObjectURL(blob);

    try {
        const image = new Image();
        image.src = objectUrl;
        await image.decode();

        return image;
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

async function imageBlobToPng(blob) {
    const source = await loadImageSource(blob);
    const sourceWidth = source.width || source.naturalWidth;
    const sourceHeight = source.height || source.naturalHeight;
    const maximumSide = 8192;
    const maximumPixels = 50000000;
    const sideScale = Math.min(1, maximumSide / Math.max(sourceWidth, sourceHeight));
    const pixelScale = Math.min(1, Math.sqrt(maximumPixels / (sourceWidth * sourceHeight)));
    const scale = Math.min(sideScale, pixelScale);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    source.close?.();

    return canvasToPngBlob(canvas);
}

async function copyImageAsset(asset) {
    const png = (async () => {
        let latestError;

        for (const url of [asset.original_url, asset.viewer_url, asset.preview_url]) {
            try {
                const response = await fetch(url, { credentials: 'same-origin' });

                if (! response.ok) {
                    throw new Error(`The image could not be loaded (${response.status}).`);
                }

                return imageBlobToPng(await response.blob());
            } catch (error) {
                latestError = error;
            }
        }

        throw latestError || new Error('The image could not be copied.');
    })();

    await copyPngBlob(png);
}

function formatNumber(value) {
    return new Intl.NumberFormat().format(value || 0);
}

function formatBytes(bytes) {
    if (! bytes) {
        return '—';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);

    return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex > 1 ? 1 : 0)} ${units[unitIndex]}`;
}

function formatDuration(seconds) {
    if (! seconds) {
        return null;
    }

    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');

    return `${minutes}:${remainder}`;
}

function formatDate(timestamp) {
    if (! timestamp) {
        return '—';
    }

    return new Intl.DateTimeFormat(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    }).format(new Date(Number(timestamp)));
}

function useDebouncedValue(value, delay) {
    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
        const timeout = window.setTimeout(() => setDebouncedValue(value), delay);

        return () => window.clearTimeout(timeout);
    }, [delay, value]);

    return debouncedValue;
}

function offlineSortValue(value) {
    return [...String(value)].reduce((hash, character) => ((hash * 31) + character.charCodeAt(0)) >>> 0, 0);
}

function assetMatchesSmartFolder(asset, smartFolder) {
    function matchesRule(rule) {
        const values = Array.isArray(rule.value) ? rule.value : [rule.value];

        if (rule.property === 'tags') {
            const tags = asset.tags || [];

            return rule.method === 'intersection'
                ? values.every(value => tags.includes(value))
                : values.some(value => tags.includes(value));
        }

        const property = {
            annotation: 'annotation',
            ext: 'extension',
            height: 'height',
            name: 'name',
            rating: 'rating',
            url: 'url',
            width: 'width',
        }[rule.property];

        if (! property) {
            return false;
        }

        const actual = asset[property];
        const expected = rule.value;

        if (rule.method === 'contain') {
            return String(actual || '').toLocaleLowerCase().includes(String(expected || '').toLocaleLowerCase());
        }

        if (rule.method === 'greater') {
            return Number(actual) > Number(expected);
        }

        if (rule.method === 'less') {
            return Number(actual) < Number(expected);
        }

        return String(actual || '').toLocaleLowerCase() === String(expected || '').toLocaleLowerCase();
    }

    return (smartFolder?.conditions || []).every(condition => {
        const results = (condition.rules || []).map(matchesRule);
        const matches = String(condition.match || 'AND').toUpperCase() === 'OR'
            ? results.some(Boolean)
            : results.every(Boolean);

        return String(condition.boolean || 'TRUE').toUpperCase() === 'FALSE' ? ! matches : matches;
    });
}

function filterOfflineAssets(allAssets, { navigation, search, selection, sort, type }) {
    const query = search.trim().toLocaleLowerCase();
    const smartFolder = selection.smart
        ? navigation?.smart_folders.find(folder => folder.id === selection.smart)
        : null;
    const filtered = allAssets.filter(asset => {
        if (selection.view === 'trash' ? ! asset.is_deleted : asset.is_deleted) {
            return false;
        }

        if (query) {
            const searchable = [
                asset.name,
                asset.annotation,
                asset.url,
                asset.extension,
                ...(asset.tags || []),
            ].filter(Boolean).join(' ').toLocaleLowerCase();

            if (! searchable.includes(query)) {
                return false;
            }
        }

        if (selection.view === 'uncategorized' && asset.folder_ids.length) {
            return false;
        }

        if (selection.view === 'untagged' && asset.tags.length) {
            return false;
        }

        if (selection.folder && ! asset.folder_ids.includes(selection.folder)) {
            return false;
        }

        if (selection.smart && ! assetMatchesSmartFolder(asset, smartFolder)) {
            return false;
        }

        if (selection.tag && ! asset.tags.includes(selection.tag)) {
            return false;
        }

        return ! type || asset.media_type === type;
    });

    return filtered.sort((left, right) => {
        if (selection.view === 'random') {
            return offlineSortValue(left.id) - offlineSortValue(right.id);
        }

        if (sort === 'oldest') {
            return Number(left.modification_time) - Number(right.modification_time);
        }

        if (sort === 'name') {
            return left.name.localeCompare(right.name);
        }

        return Number(right.modification_time) - Number(left.modification_time);
    });
}

function App() {
    const online = useOnlineStatus();
    const [libraries, setLibraries] = useState([]);
    const [librarySlug, setLibrarySlug] = useState(null);
    const [navigation, setNavigation] = useState(null);
    const [assets, setAssets] = useState([]);
    const [meta, setMeta] = useState({ current_page: 1, last_page: 1, total: 0 });
    const [selection, setSelection] = useState({ view: 'all', folder: null, smart: null, tag: null });
    const [selectedAssetId, setSelectedAssetId] = useState(null);
    const [search, setSearch] = useState('');
    const [type, setType] = useState('');
    const [sort, setSort] = useState('newest');
    const [page, setPage] = useState(1);
    const [gridSize, setGridSize] = useState(210);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(true);
    const [draggingFiles, setDraggingFiles] = useState(false);
    const [installPrompt, setInstallPrompt] = useState(null);
    const [quickLookAsset, setQuickLookAsset] = useState(null);
    const [viewerAssetId, setViewerAssetId] = useState(null);
    const [toast, setToast] = useState(null);
    const dragDepth = useRef(0);
    const fileInput = useRef(null);
    const offlineLibraryIndexes = useRef(new Map());
    const debouncedSearch = useDebouncedValue(search, 250);

    const activeLibrary = libraries.find(library => library.slug === librarySlug);
    const selectedAsset = assets.find(asset => asset.id === selectedAssetId) || null;
    const viewerAsset = assets.find(asset => asset.id === viewerAssetId) || null;
    const viewerAssetIndex = assets.findIndex(asset => asset.id === viewerAssetId);
    const currentFolderId = selection.folder;

    const flash = useCallback((message, kind = 'success') => {
        setToast({ message, kind });
        window.setTimeout(() => setToast(null), 3200);
    }, []);

    const loadLibraries = useCallback(async () => {
        try {
            const response = await api('/api/libraries');
            const availableLibraries = response?.data || [];
            setLibraries(availableLibraries);
            setLibrarySlug(current => current || availableLibraries[0]?.slug || null);

            if (! availableLibraries.length) {
                setLoading(false);
            }
        } catch (error) {
            setLoading(false);
            flash(error.message, 'error');
        }
    }, [flash]);

    const loadNavigation = useCallback(async () => {
        if (! librarySlug) {
            return;
        }

        try {
            const response = await api(`/api/libraries/${librarySlug}/folders`);
            setNavigation(response.data);
        } catch (error) {
            flash(error.message, 'error');
        }
    }, [flash, librarySlug]);

    const loadOfflineLibraryIndex = useCallback(async slug => {
        const existing = offlineLibraryIndexes.current.get(slug);

        if (existing) {
            return existing instanceof Promise ? existing : Promise.resolve(existing);
        }

        const pending = (async () => {
            const first = await api(`/api/libraries/${slug}/offline-assets?page=1`);
            const allAssets = [...(first?.data || [])];

            for (let pageNumber = 2; pageNumber <= (first?.meta?.last_page || 1); pageNumber += 1) {
                const response = await api(`/api/libraries/${slug}/offline-assets?page=${pageNumber}`);
                allAssets.push(...(response?.data || []));
            }

            offlineLibraryIndexes.current.set(slug, allAssets);

            return allAssets;
        })();

        offlineLibraryIndexes.current.set(slug, pending);

        try {
            return await pending;
        } catch (error) {
            offlineLibraryIndexes.current.delete(slug);

            throw error;
        }
    }, []);

    const invalidateOfflineLibraryIndex = useCallback(slug => {
        offlineLibraryIndexes.current.delete(slug);
    }, []);

    const loadAssets = useCallback(async ({ append = false, silent = false } = {}) => {
        if (! librarySlug) {
            return;
        }

        if (! silent) {
            append ? setLoadingMore(true) : setLoading(true);
        }

        const parameters = new URLSearchParams({
            view: selection.view,
            page: String(page),
            per_page: '60',
            sort,
        });

        if (debouncedSearch) {
            parameters.set('q', debouncedSearch);
        }

        if (selection.folder) {
            parameters.set('folder', selection.folder);
        }

        if (selection.smart) {
            parameters.set('smart', selection.smart);
        }

        if (selection.tag) {
            parameters.set('tag', selection.tag);
        }

        if (type) {
            parameters.set('type', type);
        }

        try {
            let nextAssets;
            let nextMeta;

            const loadOfflinePage = async () => {
                const offlineAssets = await loadOfflineLibraryIndex(librarySlug);
                const filteredAssets = filterOfflineAssets(offlineAssets, {
                    navigation,
                    search: debouncedSearch,
                    selection,
                    sort,
                    type,
                });
                const perPage = 60;
                const firstIndex = (page - 1) * perPage;
                return {
                    assets: filteredAssets.slice(firstIndex, firstIndex + perPage),
                    meta: {
                        current_page: page,
                        last_page: Math.max(1, Math.ceil(filteredAssets.length / perPage)),
                        per_page: perPage,
                        total: filteredAssets.length,
                    },
                };
            };

            if (! online) {
                const offlinePage = await loadOfflinePage();
                nextAssets = offlinePage.assets;
                nextMeta = offlinePage.meta;
            } else {
                try {
                    const response = await api(`/api/libraries/${librarySlug}/assets?${parameters}`);
                    nextAssets = response.data;
                    nextMeta = response.meta;
                } catch {
                    const offlinePage = await loadOfflinePage();
                    nextAssets = offlinePage.assets;
                    nextMeta = offlinePage.meta;
                }
            }

            setAssets(current => append ? [...current, ...nextAssets] : nextAssets);
            setMeta(nextMeta);
            setSelectedAssetId(current => {
                if (append || nextAssets.some(asset => asset.id === current)) {
                    return current;
                }

                return null;
            });
        } catch (error) {
            flash(error.message, 'error');
        } finally {
            if (! silent) {
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }, [debouncedSearch, flash, librarySlug, loadOfflineLibraryIndex, navigation, online, page, selection, sort, type]);

    useEffect(() => {
        loadLibraries();
    }, [loadLibraries]);

    useEffect(() => {
        if (! ('serviceWorker' in navigator)) {
            return;
        }

        navigator.serviceWorker.register('/sw.js', { scope: '/' })
            .then(() => navigator.serviceWorker.ready)
            .then(() => sendServiceWorkerMessage({ type: 'CACHE_APP_SHELL' }, { timeout: 30000 }))
            .catch(() => null);
    }, []);

    useEffect(() => {
        const handleInstallPrompt = event => {
            event.preventDefault();
            setInstallPrompt(event);
        };
        const handleInstalled = () => setInstallPrompt(null);

        window.addEventListener('beforeinstallprompt', handleInstallPrompt);
        window.addEventListener('appinstalled', handleInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
            window.removeEventListener('appinstalled', handleInstalled);
        };
    }, []);

    useEffect(() => {
        setNavigation(null);
        setSelection({ view: 'all', folder: null, smart: null, tag: null });
        setAssets([]);
        setPage(1);
        loadNavigation();
    }, [librarySlug, loadNavigation]);

    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, librarySlug, selection, sort, type]);

    useEffect(() => {
        loadAssets({ append: page > 1 });
    }, [loadAssets, page]);

    useEffect(() => {
        if (! online || ! activeLibrary || activeLibrary.indexed_at) {
            return;
        }

        const interval = window.setInterval(() => {
            loadLibraries();
            loadAssets({ silent: true });
        }, 5000);

        return () => window.clearInterval(interval);
    }, [activeLibrary?.indexed_at, activeLibrary?.slug, loadAssets, loadLibraries, online]);

    useEffect(() => {
        if (selectedAsset && window.innerWidth < 900) {
            setDetailsOpen(true);
        }
    }, [selectedAsset]);

    function chooseNavigation(nextSelection) {
        setSelection({ view: 'all', folder: null, smart: null, tag: null, ...nextSelection });
        setSidebarOpen(false);
    }

    function selectAsset(assetId) {
        setSelectedAssetId(assetId);
        setDetailsOpen(true);
    }

    function viewAsset(assetId) {
        setQuickLookAsset(null);
        setSelectedAssetId(assetId);
        setViewerAssetId(assetId);
    }

    async function uploadFiles(files) {
        if (! files.length) {
            return;
        }

        if (! online) {
            flash('Uploads need an internet connection.', 'error');

            return;
        }

        if (files.length > 20) {
            flash('Add up to 20 assets at a time.', 'error');

            return;
        }

        const formData = new FormData();
        files.forEach(file => formData.append('files[]', file));

        if (currentFolderId) {
            formData.append('folder_ids[]', currentFolderId);
        }

        setUploading(true);

        try {
            await api(`/api/libraries/${librarySlug}/assets`, {
                method: 'POST',
                body: formData,
            });
            setPage(1);
            await Promise.all([loadAssets(), loadNavigation(), loadLibraries()]);
            flash(`${files.length} ${files.length === 1 ? 'asset' : 'assets'} added`);
        } catch (error) {
            flash(error.message, 'error');
        } finally {
            setUploading(false);
        }
    }

    function handleUpload(event) {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        uploadFiles(files);
    }

    function handleDragEnter(event) {
        if (! event.dataTransfer.types.includes('Files')) {
            return;
        }

        event.preventDefault();
        dragDepth.current += 1;
        setDraggingFiles(true);
    }

    function handleDragOver(event) {
        if (! event.dataTransfer.types.includes('Files')) {
            return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = online ? 'copy' : 'none';
    }

    function handleDragLeave(event) {
        if (! event.dataTransfer.types.includes('Files')) {
            return;
        }

        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);

        if (dragDepth.current === 0) {
            setDraggingFiles(false);
        }
    }

    function handleDrop(event) {
        event.preventDefault();
        dragDepth.current = 0;
        setDraggingFiles(false);
        uploadFiles(Array.from(event.dataTransfer.files || []));
    }

    async function installApp() {
        if (! installPrompt) {
            return;
        }

        await installPrompt.prompt();
        await installPrompt.userChoice;
        setInstallPrompt(null);
    }

    async function updateAsset(attributes) {
        if (! selectedAsset) {
            return;
        }

        if (! online) {
            flash('Changes are read-only while offline.', 'error');

            return;
        }

        try {
            const response = await api(`/api/libraries/${librarySlug}/assets/${selectedAsset.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(attributes),
            });
            setAssets(current => current.map(asset => asset.id === selectedAsset.id ? response.data : asset));
            await loadNavigation();
            flash('Asset updated');
        } catch (error) {
            flash(error.message, 'error');
        }
    }

    async function moveToTrash() {
        if (! selectedAsset) {
            return;
        }

        if (! online) {
            flash('Changes are read-only while offline.', 'error');

            return;
        }

        try {
            await api(`/api/libraries/${librarySlug}/assets/${selectedAsset.id}`, { method: 'DELETE' });
            setAssets(current => current.filter(asset => asset.id !== selectedAsset.id));
            setSelectedAssetId(null);
            await loadNavigation();
            flash('Moved to trash');
        } catch (error) {
            flash(error.message, 'error');
        }
    }

    const viewTitle = useMemo(() => {
        if (selection.folder) {
            return navigation?.folders.find(folder => folder.id === selection.folder)?.name || 'Folder';
        }

        if (selection.smart) {
            return navigation?.smart_folders.find(folder => folder.id === selection.smart)?.name || 'Smart folder';
        }

        if (selection.tag) {
            return `#${selection.tag}`;
        }

        return {
            all: 'All assets',
            uncategorized: 'Uncategorized',
            untagged: 'Untagged',
            recent: 'Recently used',
            random: 'Random',
            trash: 'Trash',
        }[selection.view];
    }, [navigation, selection]);

    if (! libraries.length && ! loading) {
        return <EmptyLibraryState online={online} onRefresh={loadLibraries} />;
    }

    return (
        <div
            className={`app-shell ${detailsOpen && selectedAsset ? 'with-details' : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            <Sidebar
                activeLibrary={activeLibrary}
                current={selection}
                libraries={libraries}
                navigation={navigation}
                online={online}
                onOfflineLibraryChange={invalidateOfflineLibraryIndex}
                onInstall={installPrompt ? installApp : null}
                onChoose={chooseNavigation}
                onLibraryChange={setLibrarySlug}
                open={sidebarOpen}
            />

            <main className="workspace">
                <Header
                    gridSize={gridSize}
                    libraryName={activeLibrary?.name}
                    online={online}
                    onGridSizeChange={setGridSize}
                    onMenu={() => setSidebarOpen(true)}
                    onUpload={() => online
                        ? fileInput.current?.click()
                        : flash('Uploads need an internet connection.', 'error')}
                    search={search}
                    setSearch={setSearch}
                    uploading={uploading}
                />

                <FilterBar
                    onSort={setSort}
                    onType={setType}
                    sort={sort}
                    type={type}
                    viewTitle={viewTitle}
                    visibleCount={meta.total}
                />

                <AssetGrid
                    assets={assets}
                    gridSize={gridSize}
                    loading={loading}
                    onLoadMore={() => setPage(current => current + 1)}
                    onSelect={selectAsset}
                    onQuickLook={setQuickLookAsset}
                    onView={viewAsset}
                    canLoadMore={meta.current_page < meta.last_page}
                    loadingMore={loadingMore}
                    indexing={! activeLibrary?.indexed_at}
                    selectedAssetId={selectedAssetId}
                />
            </main>

            {selectedAsset && detailsOpen && (
                <DetailsPanel
                    asset={selectedAsset}
                    folders={navigation?.folders || []}
                    onClose={() => setDetailsOpen(false)}
                    onDelete={moveToTrash}
                    onUpdate={updateAsset}
                    online={online}
                />
            )}

            {sidebarOpen && (
                <button
                    className="mobile-scrim"
                    onClick={() => setSidebarOpen(false)}
                    aria-label="Close menu"
                />
            )}
            <input ref={fileInput} hidden type="file" multiple accept="image/*,video/*" onChange={handleUpload} />
            {quickLookAsset && ! viewerAsset && <QuickLook asset={quickLookAsset} />}
            {viewerAsset && (
                <AssetViewer
                    asset={viewerAsset}
                    canMoveNext={viewerAssetIndex < assets.length - 1}
                    canMovePrevious={viewerAssetIndex > 0}
                    online={online}
                    onClose={() => setViewerAssetId(null)}
                    onMoveNext={() => viewAsset(assets[viewerAssetIndex + 1].id)}
                    onMovePrevious={() => viewAsset(assets[viewerAssetIndex - 1].id)}
                />
            )}
            {draggingFiles && (
                <DropOverlay
                    destination={navigation?.folders.find(folder => folder.id === currentFolderId)?.name
                        || activeLibrary?.name}
                    online={online}
                />
            )}
            {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
        </div>
    );
}

function Sidebar({
    activeLibrary,
    current,
    libraries,
    navigation,
    online,
    onChoose,
    onInstall,
    onLibraryChange,
    onOfflineLibraryChange,
    open,
}) {
    const standardViews = [
        { key: 'all', label: 'All assets', icon: Grid3X3, count: navigation?.counts.all },
        { key: 'uncategorized', label: 'Uncategorized', icon: FolderOpen, count: navigation?.counts.uncategorized },
        { key: 'untagged', label: 'Untagged', icon: Tags, count: navigation?.counts.untagged },
        { key: 'recent', label: 'Recently used', icon: Clock3 },
        { key: 'random', label: 'Random', icon: Shuffle },
        { key: 'trash', label: 'Trash', icon: Trash2, count: navigation?.counts.trash },
    ];

    return (
        <aside className={`sidebar ${open ? 'open' : ''}`}>
            <div className="sidebar-brand">
                <div className="brand-mark"><span></span><span></span><span></span></div>
                <span>Indexframe</span>
            </div>

            <div className="library-select-wrap">
                <LibraryBig size={17} />
                <select value={activeLibrary?.slug || ''} onChange={event => onLibraryChange(event.target.value)}>
                    {libraries.map(library => <option value={library.slug} key={library.slug}>{library.name}</option>)}
                </select>
                <ChevronDown size={14} />
            </div>

            <nav className="sidebar-scroll">
                <div className="nav-group">
                    {standardViews.map(item => (
                        <SidebarItem
                            active={current.view === item.key && ! current.folder && ! current.smart && ! current.tag}
                            count={item.count}
                            icon={item.icon}
                            key={item.key}
                            label={item.label}
                            onClick={() => onChoose({ view: item.key })}
                        />
                    ))}
                </div>

                {!! navigation?.smart_folders.length && (
                    <div className="nav-group">
                        <p className="nav-heading">Smart folders</p>
                        {navigation.smart_folders.map(folder => (
                            <SidebarItem
                                active={current.smart === folder.id}
                                count={folder.count}
                                icon={FolderOpen}
                                key={folder.id}
                                label={folder.name}
                                onClick={() => onChoose({ smart: folder.id })}
                            />
                        ))}
                    </div>
                )}

                {!! navigation?.folders.length && (
                    <div className="nav-group">
                        <p className="nav-heading">Folders</p>
                        {navigation.folders.map(folder => (
                            <SidebarItem
                                active={current.folder === folder.id}
                                count={folder.count}
                                icon={Folder}
                                indent={folder.parent_id ? 1 : 0}
                                key={folder.id}
                                label={folder.name}
                                onClick={() => onChoose({ folder: folder.id })}
                            />
                        ))}
                    </div>
                )}

                {!! navigation?.tags.length && (
                    <div className="nav-group">
                        <p className="nav-heading">Popular tags</p>
                        <div className="sidebar-tags">
                            {navigation.tags.slice(0, 12).map(tag => (
                                <button
                                    className={current.tag === tag.name ? 'active' : ''}
                                    key={tag.name}
                                    onClick={() => onChoose({ tag: tag.name })}
                                >
                                    {tag.name} <span>{tag.count}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </nav>

            {activeLibrary && (
                <OfflineLibraryControl
                    library={activeLibrary}
                    online={online}
                    onIndexChange={onOfflineLibraryChange}
                />
            )}

            {onInstall && (
                <button className="install-app-button" onClick={onInstall}>
                    <Download size={15} /> Install app
                </button>
            )}

            <form
                action="/logout"
                method="POST"
                className="logout-form"
                onSubmit={async event => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    await clearOfflineData();

                    if (! navigator.onLine) {
                        window.location.assign('/login');

                        return;
                    }

                    form.submit();
                }}
            >
                <input type="hidden" name="_token" value={csrfToken} />
                <button><LogOut size={15} /> Lock archive</button>
            </form>
        </aside>
    );
}

function SidebarItem({ active, count, icon: Icon, indent = 0, label, onClick }) {
    return (
        <button className={`sidebar-item ${active ? 'active' : ''}`} style={{ '--indent': indent }} onClick={onClick}>
            <Icon size={16} />
            <span>{label}</span>
            {count !== undefined && <small>{formatNumber(count)}</small>}
        </button>
    );
}

function useOfflineLibrary(library, onIndexChange) {
    const supported = 'serviceWorker' in navigator;
    const [status, setStatus] = useState(undefined);
    const [error, setError] = useState(null);
    const [storage, setStorage] = useState(null);

    const refreshStorage = useCallback(async () => {
        if (! navigator.storage?.estimate) {
            return;
        }

        setStorage(await navigator.storage.estimate());
    }, []);

    const refreshStatus = useCallback(async () => {
        setStatus(undefined);
        setError(null);

        if (! supported) {
            setStatus(null);
            setError('Offline storage needs HTTPS and a browser with service worker support.');

            return;
        }

        try {
            const result = await sendServiceWorkerMessage({
                type: 'GET_LIBRARY_CACHE_STATUS',
                library: library.slug,
            }, { timeout: 10000 });
            setStatus(result.status || null);
        } catch (caughtError) {
            setStatus(null);
            setError(caughtError.message);
        }

        await refreshStorage();
    }, [library.slug, refreshStorage, supported]);

    useEffect(() => {
        refreshStatus();
    }, [refreshStatus]);

    async function save() {
        setError(null);
        setStatus(current => ({
            downloaded_bytes: current?.downloaded_bytes || 0,
            processed: 0,
            skipped: 0,
            state: 'caching',
            total: current?.total || 0,
        }));

        try {
            if (navigator.storage?.persist) {
                await navigator.storage.persist();
            }

            const result = await sendServiceWorkerMessage({
                type: 'CACHE_LIBRARY',
                library: library.slug,
            }, {
                onProgress: setStatus,
                timeout: 86400000,
            });
            setStatus(result.status || null);
            onIndexChange(library.slug);
            await refreshStorage();
        } catch (caughtError) {
            setStatus(current => current ? { ...current, state: 'partial' } : null);
            setError(caughtError.message);
            await refreshStorage();
        }
    }

    async function pause() {
        try {
            await sendServiceWorkerMessage({
                type: 'CANCEL_LIBRARY_CACHE',
                library: library.slug,
            }, { timeout: 10000 });
        } catch (caughtError) {
            setError(caughtError.message);
        }
    }

    async function remove() {
        setError(null);

        try {
            await sendServiceWorkerMessage({
                type: 'REMOVE_LIBRARY_CACHE',
                library: library.slug,
            }, { timeout: 300000 });
            setStatus(null);
            onIndexChange(library.slug);
            await refreshStorage();
        } catch (caughtError) {
            setError(caughtError.message);
        }
    }

    return { error, pause, remove, save, status, storage, supported };
}

function OfflineLibraryControl({ library, online, onIndexChange }) {
    const { error, pause, remove, save, status, storage, supported } = useOfflineLibrary(library, onIndexChange);
    const percentage = status?.total
        ? Math.min(100, Math.round((status.processed / status.total) * 100))
        : 0;
    const ready = status?.state === 'complete';
    const partial = status?.state === 'partial';
    const caching = status?.state === 'caching';

    return (
        <section className="offline-library-control" aria-label="Offline library">
            <div className="offline-library-heading">
                <span>{ready ? <CloudCheck size={15} /> : <CloudDownload size={15} />}</span>
                <div>
                    <strong>{ready ? 'Available offline' : 'Offline library'}</strong>
                    <small>
                        {ready && `${formatNumber(status.total)} optimized previews`}
                        {partial && `Paused at ${formatNumber(status.processed)} of ${formatNumber(status.total)}`}
                        {caching && `${formatNumber(status.processed)} of ${formatNumber(status.total || 0)}`}
                        {status === null && 'Metadata, images & video posters'}
                        {status === undefined && 'Checking browser storage…'}
                    </small>
                </div>
            </div>

            {(caching || partial) && (
                <div className="offline-library-progress">
                    <span style={{ width: `${percentage}%` }} />
                </div>
            )}

            {status?.downloaded_bytes > 0 && (
                <p>{formatBytes(status.downloaded_bytes)} cached for this library</p>
            )}
            {status?.skipped > 0 && (
                <p className="offline-library-error">
                    {formatNumber(status.skipped)} unavailable {status.skipped === 1 ? 'preview was' : 'previews were'} skipped
                </p>
            )}
            {storage?.quota > 0 && (
                <p>{formatBytes(storage.usage)} of {formatBytes(storage.quota)} browser storage used</p>
            )}
            {error && <p className="offline-library-error">{error}</p>}

            <div className="offline-library-actions">
                {caching ? (
                    <button onClick={pause}><X size={13} /> Pause</button>
                ) : (
                    <button disabled={! online || ! supported || status === undefined} onClick={save}>
                        {partial ? <RefreshCw size={13} /> : <CloudDownload size={13} />}
                        {partial ? 'Resume' : ready ? 'Refresh' : 'Save offline'}
                    </button>
                )}
                {(ready || partial) && <button className="quiet" onClick={remove}>Remove</button>}
            </div>
        </section>
    );
}

function Header({ gridSize, libraryName, online, onGridSizeChange, onMenu, onUpload, search, setSearch, uploading }) {
    return (
        <header className="workspace-header">
            <div className="header-title">
                <button className="icon-button mobile-only" onClick={onMenu} aria-label="Open menu">
                    <Menu size={20} />
                </button>
                <div>
                    <p>Visual library</p>
                    <h1>{libraryName || 'Loading…'}</h1>
                </div>
            </div>

            <div className="grid-slider desktop-only">
                <Grid3X3 size={14} />
                <input
                    aria-label="Thumbnail size"
                    max="300"
                    min="150"
                    type="range"
                    value={gridSize}
                    onChange={event => onGridSizeChange(Number(event.target.value))}
                />
            </div>

            <div className="header-actions">
                <span
                    className={`connection-status ${online ? 'online' : 'offline'}`}
                    title={online ? 'Connected' : 'Offline mode'}
                >
                    {online ? <Wifi size={14} /> : <WifiOff size={14} />}
                    <span className="desktop-only">{online ? 'Online' : 'Offline'}</span>
                </span>
                <label className="search-field">
                    <Search size={17} />
                    <input
                        placeholder="Search everything…"
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                    />
                    {search && <button onClick={() => setSearch('')}><X size={14} /></button>}
                </label>
                <button className="header-upload" disabled={uploading || ! online} onClick={onUpload}>
                    {uploading ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}
                    <span className="desktop-only">Upload</span>
                </button>
            </div>
        </header>
    );
}

function FilterBar({ onSort, onType, sort, type, viewTitle, visibleCount }) {
    return (
        <div className="filter-bar">
            <div className="view-name">
                <h2>{viewTitle}</h2>
                <span>{formatNumber(visibleCount)}</span>
            </div>
            <div className="filter-controls">
                <label>
                    <span>Type</span>
                    <select value={type} onChange={event => onType(event.target.value)}>
                        <option value="">All media</option>
                        <option value="image">Images</option>
                        <option value="video">Videos</option>
                        <option value="other">Other</option>
                    </select>
                    <ChevronDown size={13} />
                </label>
                <label>
                    <span>Sort</span>
                    <select value={sort} onChange={event => onSort(event.target.value)}>
                        <option value="newest">Newest</option>
                        <option value="oldest">Oldest</option>
                        <option value="name">Name</option>
                    </select>
                    <ChevronDown size={13} />
                </label>
            </div>
        </div>
    );
}

function AssetGrid({
    assets,
    canLoadMore,
    gridSize,
    loading,
    loadingMore,
    indexing,
    onLoadMore,
    onQuickLook,
    onSelect,
    onView,
    selectedAssetId,
}) {
    if (loading) {
        return (
            <div className="loading-grid" style={{ '--grid-size': `${gridSize}px` }}>
                {Array.from({ length: 18 }).map((_, index) => <div className="skeleton-card" key={index} />)}
            </div>
        );
    }

    if (! assets.length) {
        return (
            <div className="empty-state">
                {indexing ? <LoaderCircle className="spin" size={31} /> : <ImageIcon size={31} />}
                <h3>{indexing ? 'Indexing this library…' : 'No assets found'}</h3>
                <p>
                    {indexing
                        ? 'Assets will appear here as OpenCloud metadata is processed.'
                        : 'Try another folder, media type, or search phrase.'}
                </p>
            </div>
        );
    }

    return (
        <div className="asset-scroll">
            <div className="asset-grid" style={{ '--grid-size': `${gridSize}px` }}>
                {assets.map(asset => (
                    <AssetCard
                        asset={asset}
                        key={asset.id}
                        onClick={() => onSelect(asset.id)}
                        onQuickLook={onQuickLook}
                        onView={() => onView(asset.id)}
                        selected={selectedAssetId === asset.id}
                    />
                ))}
            </div>
            {canLoadMore && (
                <button className="load-more" disabled={loadingMore} onClick={onLoadMore}>
                    {loadingMore && <LoaderCircle className="spin" size={16} />}
                    {loadingMore ? 'Loading…' : 'Load more'}
                </button>
            )}
        </div>
    );
}

function AssetCard({ asset, onClick, onQuickLook, onView, selected }) {
    const [failed, setFailed] = useState(false);
    const quickLookTimer = useRef(null);

    function startQuickLook() {
        window.clearTimeout(quickLookTimer.current);
        quickLookTimer.current = window.setTimeout(() => onQuickLook(asset), 450);
    }

    function stopQuickLook() {
        window.clearTimeout(quickLookTimer.current);
        onQuickLook(null);
    }

    useEffect(() => () => window.clearTimeout(quickLookTimer.current), []);

    return (
        <button
            className={`asset-card ${selected ? 'selected' : ''}`}
            onClick={onClick}
            onDoubleClick={() => {
                stopQuickLook();
                onView();
            }}
            onMouseEnter={startQuickLook}
            onMouseLeave={stopQuickLook}
            title={`${asset.name} · Double-click to view`}
        >
            <div className="asset-image-wrap">
                {failed ? (
                    <div className="asset-fallback">
                        {asset.media_type === 'video' ? <Film size={30} /> : <FileQuestion size={30} />}
                    </div>
                ) : (
                    <img loading="lazy" src={asset.preview_url} alt="" onError={() => setFailed(true)} />
                )}
                <span className="asset-type">{asset.extension}</span>
                {asset.duration && <span className="asset-duration">{formatDuration(asset.duration)}</span>}
            </div>
            <div className="asset-caption">
                <strong>{asset.name}</strong>
                <span>
                    {asset.width && asset.height ? `${asset.width} × ${asset.height}` : formatBytes(asset.size)}
                </span>
            </div>
        </button>
    );
}

function QuickLook({ asset }) {
    return (
        <div className="quick-look" aria-hidden="true">
            <div className="quick-look-media">
                <img src={asset.viewer_url || asset.preview_url} alt="" />
                {asset.media_type === 'video' && (
                    <span className="quick-look-video">
                        <Film size={16} /> {formatDuration(asset.duration) || 'Video'}
                    </span>
                )}
            </div>
            <div className="quick-look-caption">
                <strong>{asset.name}</strong>
                <span>
                    {asset.extension}
                    {asset.width && asset.height ? ` · ${asset.width} × ${asset.height}` : ''}
                    {` · ${formatBytes(asset.size)}`}
                </span>
            </div>
        </div>
    );
}

function AssetViewer({
    asset,
    canMoveNext,
    canMovePrevious,
    online,
    onClose,
    onMoveNext,
    onMovePrevious,
}) {
    const [copyStatus, setCopyStatus] = useState('idle');
    const [copyError, setCopyError] = useState(null);
    const [offlineVideoSaved, setOfflineVideoSaved] = useState(online);
    const video = useRef(null);

    useEffect(() => {
        setCopyStatus('idle');
        setCopyError(null);
    }, [asset.id]);

    useEffect(() => {
        let active = true;

        if (online || asset.media_type !== 'video') {
            setOfflineVideoSaved(true);

            return () => {
                active = false;
            };
        }

        setOfflineVideoSaved(null);
        sendServiceWorkerMessage({
            type: 'CHECK_ASSET',
            url: asset.original_url,
        }, { timeout: 10000 })
            .then(result => active && setOfflineVideoSaved(result.cached))
            .catch(() => active && setOfflineVideoSaved(false));

        return () => {
            active = false;
        };
    }, [asset.id, asset.media_type, asset.original_url, online]);

    useEffect(() => {
        function handleKeyDown(event) {
            if (event.key === 'Escape') {
                onClose();
            }

            if (event.key === 'ArrowLeft' && canMovePrevious) {
                onMovePrevious();
            }

            if (event.key === 'ArrowRight' && canMoveNext) {
                onMoveNext();
            }
        }

        document.addEventListener('keydown', handleKeyDown);

        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [canMoveNext, canMovePrevious, onClose, onMoveNext, onMovePrevious]);

    async function copyCurrentAsset() {
        setCopyStatus('copying');
        setCopyError(null);

        try {
            if (asset.media_type === 'video') {
                const currentVideo = video.current;

                if (! currentVideo?.videoWidth || ! currentVideo.videoHeight) {
                    throw new Error('Play the video until a frame is visible, then try again.');
                }

                const canvas = document.createElement('canvas');
                canvas.width = currentVideo.videoWidth;
                canvas.height = currentVideo.videoHeight;
                canvas.getContext('2d').drawImage(currentVideo, 0, 0, canvas.width, canvas.height);
                await copyPngBlob(canvasToPngBlob(canvas));
            } else {
                await copyImageAsset(asset);
            }

            setCopyStatus('copied');
        } catch (error) {
            setCopyStatus('idle');
            setCopyError(error.message);
        }
    }

    return (
        <div
            className="asset-viewer-backdrop"
            role="dialog"
            aria-label={`Viewing ${asset.name}`}
            aria-modal="true"
            onMouseDown={event => event.target === event.currentTarget && onClose()}
        >
            <section className="asset-viewer">
                <header className="asset-viewer-header">
                    <div>
                        <strong>{asset.name}</strong>
                        <span>
                            {asset.extension}
                            {asset.width && asset.height ? ` · ${asset.width} × ${asset.height}` : ''}
                            {` · ${formatBytes(asset.size)}`}
                        </span>
                    </div>
                    <button onClick={onClose} aria-label="Close viewer"><X size={20} /></button>
                </header>

                <div className="asset-viewer-media">
                    {asset.media_type === 'video' && offlineVideoSaved ? (
                        <video
                            ref={video}
                            controls
                            autoPlay
                            playsInline
                            poster={asset.viewer_url || asset.preview_url}
                            preload="metadata"
                            src={asset.original_url}
                        />
                    ) : asset.media_type === 'video' ? (
                        <div className="offline-video-poster">
                            <img src={asset.viewer_url || asset.preview_url} alt={asset.name} />
                            <p>
                                {offlineVideoSaved === null
                                    ? 'Checking offline video…'
                                    : 'The poster is offline. Save this video individually to play it offline.'}
                            </p>
                        </div>
                    ) : (
                        <img
                            src={asset.viewer_url || asset.preview_url}
                            alt={asset.name}
                            onError={event => {
                                const previewUrl = new URL(asset.preview_url, window.location.origin).href;

                                if (event.currentTarget.src !== previewUrl) {
                                    event.currentTarget.src = asset.preview_url;
                                }
                            }}
                        />
                    )}
                </div>

                <button
                    className="asset-viewer-navigation previous"
                    disabled={! canMovePrevious}
                    onClick={onMovePrevious}
                    aria-label="Previous asset"
                >
                    <ChevronLeft size={24} />
                </button>
                <button
                    className="asset-viewer-navigation next"
                    disabled={! canMoveNext}
                    onClick={onMoveNext}
                    aria-label="Next asset"
                >
                    <ChevronRight size={24} />
                </button>

                <footer className="asset-viewer-toolbar">
                    <div>
                        <button disabled={copyStatus === 'copying'} onClick={copyCurrentAsset}>
                            {copyStatus === 'copying' && <LoaderCircle className="spin" size={16} />}
                            {copyStatus === 'copied' && <Check size={16} />}
                            {copyStatus === 'idle' && (
                                asset.media_type === 'video' ? <Camera size={16} /> : <Copy size={16} />
                            )}
                            {copyStatus === 'copied'
                                ? 'Copied'
                                : asset.media_type === 'video' ? 'Copy current frame' : 'Copy image'}
                        </button>
                        <a href={asset.download_url} download>
                            <Download size={16} /> Download original
                        </a>
                    </div>
                    {copyError && <p>{copyError}</p>}
                    <span>Double-click an asset to view · Esc to close · ← → to browse</span>
                </footer>
            </section>
        </div>
    );
}

function DropOverlay({ destination, online }) {
    return (
        <div className={`drop-overlay ${online ? '' : 'disabled'}`}>
            <div>
                {online ? <CloudDownload size={38} /> : <WifiOff size={38} />}
                <h2>{online ? 'Drop to add assets' : 'Uploads are unavailable offline'}</h2>
                <p>{online ? `Add to ${destination || 'this library'}` : 'Reconnect, then drop the files again.'}</p>
            </div>
        </div>
    );
}

function useOfflineAsset(asset) {
    const [status, setStatus] = useState('checking');

    useEffect(() => {
        let active = true;
        setStatus('checking');

        sendServiceWorkerMessage({
            type: 'CHECK_ASSET',
            url: asset.original_url,
        }, { timeout: 10000 })
            .then(result => active && setStatus(result.cached ? 'saved' : 'available'))
            .catch(() => active && setStatus('unsupported'));

        return () => {
            active = false;
        };
    }, [asset.id, asset.original_url]);

    async function save() {
        setStatus('saving');

        try {
            if (navigator.storage?.persist) {
                await navigator.storage.persist();
            }

            await sendServiceWorkerMessage({
                type: 'CACHE_ASSET',
                urls: [asset.preview_url, asset.viewer_url, asset.original_url],
            });
            setStatus('saved');
        } catch (error) {
            setStatus('available');
            throw error;
        }
    }

    async function remove() {
        setStatus('saving');

        try {
            await sendServiceWorkerMessage({
                type: 'REMOVE_ASSET',
                urls: [asset.preview_url, asset.viewer_url, asset.original_url],
            }, { timeout: 30000 });
            setStatus('available');
        } catch (error) {
            setStatus('saved');
            throw error;
        }
    }

    return { remove, save, status };
}

function DetailsPanel({ asset, folders, onClose, onDelete, onUpdate, online }) {
    const [name, setName] = useState(asset.name || '');
    const [annotation, setAnnotation] = useState(asset.annotation || '');
    const [url, setUrl] = useState(asset.url || '');
    const [tagInput, setTagInput] = useState('');
    const { remove: removeOfflineCopy, save: saveOfflineCopy, status: offlineStatus } = useOfflineAsset(asset);
    const [offlineError, setOfflineError] = useState(null);

    useEffect(() => {
        setName(asset.name || '');
        setAnnotation(asset.annotation || '');
        setUrl(asset.url || '');
        setTagInput('');
        setOfflineError(null);
    }, [asset]);

    function addTag(event) {
        event.preventDefault();
        const tag = tagInput.trim();

        if (! tag || asset.tags.includes(tag)) {
            return;
        }

        onUpdate({ tags: [...asset.tags, tag] });
        setTagInput('');
    }

    return (
        <aside className="details-panel">
            <div className="details-header">
                <p>Asset details</p>
                <button className="icon-button" onClick={onClose} aria-label="Close details"><X size={18} /></button>
            </div>
            <div className="details-scroll">
                <a className="details-preview" href={asset.original_url} target="_blank" rel="noreferrer">
                    {asset.media_type === 'video' ? (
                        <video controls playsInline poster={asset.viewer_url || asset.preview_url} src={asset.original_url} />
                    ) : (
                        <img src={asset.preview_url} alt="" />
                    )}
                    <span>{asset.extension}</span>
                </a>

                <div className="details-section primary-fields">
                    <label>
                        <span>Name</span>
                        <textarea
                            disabled={! online}
                            value={name}
                            rows="2"
                            onChange={event => setName(event.target.value)}
                            onBlur={() => name !== asset.name && onUpdate({ name })}
                        />
                    </label>
                    <label>
                        <span>Notes</span>
                        <textarea
                            disabled={! online}
                            placeholder="Add context, credits, or a thought…"
                            rows="4"
                            value={annotation}
                            onChange={event => setAnnotation(event.target.value)}
                            onBlur={() => annotation !== (asset.annotation || '') && onUpdate({ annotation })}
                        />
                    </label>
                    <label>
                        <span>Source</span>
                        <div className="input-with-icon">
                            <input
                                disabled={! online}
                                placeholder="https://…"
                                type="url"
                                value={url}
                                onChange={event => setUrl(event.target.value)}
                                onBlur={() => url !== (asset.url || '') && onUpdate({ url })}
                            />
                            {asset.url && (
                                <a href={asset.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /></a>
                            )}
                        </div>
                    </label>
                </div>

                <div className="details-section">
                    <p className="details-label">Rating</p>
                    <div className="rating-row">
                        {[1, 2, 3, 4, 5].map(rating => (
                            <button
                                disabled={! online}
                                key={rating}
                                onClick={() => onUpdate({ rating: asset.rating === rating ? 0 : rating })}
                            >
                                <Star fill={rating <= asset.rating ? 'currentColor' : 'none'} size={19} />
                            </button>
                        ))}
                    </div>
                </div>

                <div className="details-section">
                    <p className="details-label">Tags</p>
                    <div className="tag-list">
                        {asset.tags.map(tag => (
                            <button
                                disabled={! online}
                                key={tag}
                                onClick={() => onUpdate({ tags: asset.tags.filter(current => current !== tag) })}
                            >
                                {tag} <X size={11} />
                            </button>
                        ))}
                    </div>
                    <form className="tag-input" onSubmit={addTag}>
                        <Plus size={14} />
                        <input
                            disabled={! online}
                            placeholder="New tag"
                            value={tagInput}
                            onChange={event => setTagInput(event.target.value)}
                        />
                    </form>
                </div>

                <div className="details-section">
                    <p className="details-label">Folders</p>
                    <div className="folder-checks">
                        {folders.map(folder => (
                            <label key={folder.id}>
                                <input
                                    type="checkbox"
                                    disabled={! online}
                                    checked={asset.folder_ids.includes(folder.id)}
                                    onChange={event => {
                                        const folderIds = event.target.checked
                                            ? [...asset.folder_ids, folder.id]
                                            : asset.folder_ids.filter(id => id !== folder.id);
                                        onUpdate({ folder_ids: folderIds });
                                    }}
                                />
                                <Folder size={14} /> {folder.name}
                            </label>
                        ))}
                    </div>
                </div>

                {!! asset.palettes.length && (
                    <div className="details-section">
                        <p className="details-label">Palette</p>
                        <div className="palette-row">
                            {asset.palettes.slice(0, 9).map((palette, index) => (
                                <span
                                    key={index}
                                    style={{ backgroundColor: `rgb(${palette.color.join(',')})` }}
                                    title={`${palette.ratio}%`}
                                />
                            ))}
                        </div>
                    </div>
                )}

                <div className="details-section property-list">
                    <p className="details-label">Properties</p>
                    <dl>
                        <div><dt>Type</dt><dd>{asset.extension}</dd></div>
                        <div>
                            <dt>Dimensions</dt>
                            <dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : '—'}</dd>
                        </div>
                        {asset.duration && <div><dt>Duration</dt><dd>{formatDuration(asset.duration)}</dd></div>}
                        <div><dt>Size</dt><dd>{formatBytes(asset.size)}</dd></div>
                        <div><dt>Imported</dt><dd>{formatDate(asset.birth_time)}</dd></div>
                        <div><dt>Modified</dt><dd>{formatDate(asset.modification_time)}</dd></div>
                    </dl>
                </div>

                <div className="details-actions">
                    {offlineStatus !== 'unsupported' && (
                        <button
                            className={`offline-button ${offlineStatus === 'saved' ? 'saved' : ''}`}
                            disabled={offlineStatus === 'checking'
                                || offlineStatus === 'saving'
                                || (! online && offlineStatus !== 'saved')}
                            onClick={async () => {
                                setOfflineError(null);

                                try {
                                    offlineStatus === 'saved'
                                        ? await removeOfflineCopy()
                                        : await saveOfflineCopy();
                                } catch (error) {
                                    setOfflineError(error.message);
                                }
                            }}
                        >
                            {offlineStatus === 'saving' && <LoaderCircle className="spin" size={16} />}
                            {offlineStatus === 'saved' && <CloudCheck size={16} />}
                            {! ['saving', 'saved'].includes(offlineStatus) && <CloudDownload size={16} />}
                            {{
                                checking: 'Checking offline copy…',
                                saving: 'Updating offline copy…',
                                saved: 'Saved offline · Remove',
                                available: `Save offline · ${formatBytes(asset.size)}`,
                            }[offlineStatus]}
                        </button>
                    )}
                    {offlineError && <p className="offline-error">{offlineError}</p>}
                    <a className="download-button" href={asset.download_url}>
                        <Download size={16} /> Download original
                    </a>
                    {asset.is_deleted ? (
                        <button
                            className="restore-button"
                            disabled={! online}
                            onClick={() => onUpdate({ is_deleted: false })}
                        >
                            <ArchiveRestore size={16} /> Restore
                        </button>
                    ) : (
                        <button className="trash-button" disabled={! online} onClick={onDelete}>
                            <Trash2 size={16} /> Move to trash
                        </button>
                    )}
                </div>
            </div>
        </aside>
    );
}

function OpenCloudBrowser({ onClose }) {
    const [directory, setDirectory] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [copied, setCopied] = useState(false);

    const loadDirectory = useCallback(async path => {
        setLoading(true);
        setError(null);
        setCopied(false);

        try {
            const parameters = new URLSearchParams({ path });
            const response = await api(`/api/opencloud/directories?${parameters}`);
            setDirectory(response.data);
        } catch (exception) {
            setError(exception.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDirectory('/');
    }, [loadDirectory]);

    useEffect(() => {
        function handleKeyDown(event) {
            if (event.key === 'Escape') {
                onClose();
            }
        }

        document.addEventListener('keydown', handleKeyDown);

        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    async function copyRoot() {
        try {
            await copyText(`OPENCLOUD_WEBDAV_ROOT=${directory.path}`);
            setCopied(true);
        } catch (exception) {
            setError(exception.message);
        }
    }

    return (
        <div
            className="storage-browser-backdrop"
            role="dialog"
            aria-label="Browse OpenCloud folders"
            aria-modal="true"
            onMouseDown={event => event.target === event.currentTarget && onClose()}
        >
            <section className="storage-browser">
                <header className="storage-browser-header">
                    <div>
                        <p>WebDAV setup</p>
                        <h2>Choose the library folder</h2>
                    </div>
                    <button onClick={onClose} aria-label="Close OpenCloud browser"><X size={20} /></button>
                </header>

                <div className="storage-browser-status">
                    <span>Configured root</span>
                    <code>{directory?.configured_root || 'Loading…'}</code>
                </div>

                <div className="storage-browser-path">
                    <button
                        disabled={loading || ! directory?.parent}
                        onClick={() => loadDirectory(directory.parent)}
                        aria-label="Open parent folder"
                    >
                        <ChevronLeft size={17} />
                    </button>
                    <FolderOpen size={17} />
                    <code>{directory?.path || '/'}</code>
                    {directory?.path === directory?.configured_root && <span>Configured</span>}
                </div>

                <div className="storage-browser-list">
                    {loading && (
                        <div className="storage-browser-message">
                            <LoaderCircle className="spin" size={22} />
                            <p>Reading OpenCloud…</p>
                        </div>
                    )}

                    {! loading && error && (
                        <div className="storage-browser-message error">
                            <FileQuestion size={25} />
                            <p>{error}</p>
                            <button onClick={() => loadDirectory(directory?.path || '/')}>Try again</button>
                        </div>
                    )}

                    {! loading && ! error && ! directory?.directories.length && (
                        <div className="storage-browser-message">
                            <Folder size={25} />
                            <p>This folder has no subfolders.</p>
                        </div>
                    )}

                    {! loading && ! error && directory?.directories.map(item => (
                        item.is_library ? (
                            <div className="storage-browser-entry library" key={item.path}>
                                <LibraryBig size={18} />
                                <span>{item.name}</span>
                                <strong>Library</strong>
                            </div>
                        ) : (
                            <button
                                className="storage-browser-entry"
                                key={item.path}
                                onClick={() => loadDirectory(item.path)}
                            >
                                <Folder size={18} />
                                <span>{item.name}</span>
                                <ChevronRight size={16} />
                            </button>
                        )
                    ))}
                </div>

                <footer className="storage-browser-footer">
                    <div>
                        {directory?.library_count > 0 ? (
                            <p>
                                Found {directory.library_count}
                                {' '}{directory.library_count === 1 ? 'library' : 'libraries'} directly in this folder.
                            </p>
                        ) : (
                            <p>Open folders until the `.library` directories are shown here.</p>
                        )}
                        {copied && <span>Copied. Paste it into Dokploy, redeploy, then run `eagle:sync --prune`.</span>}
                    </div>
                    <button disabled={! directory?.library_count || loading} onClick={copyRoot}>
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        {copied ? 'Root copied' : 'Copy root value'}
                    </button>
                </footer>
            </section>
        </div>
    );
}

function EmptyLibraryState({ online, onRefresh }) {
    const [browserOpen, setBrowserOpen] = useState(false);

    return (
        <div className="empty-library">
            <div className="brand-mark"><span></span><span></span><span></span></div>
            <p className="eyebrow">Indexframe</p>
            <h1>No libraries indexed yet.</h1>
            <p>
                Browse the configured OpenCloud Space to find the folder that directly contains your
                {' '}<code>.library</code> directories, then update the WebDAV root and run a sync.
            </p>
            <div className="empty-library-actions">
                <button disabled={! online} onClick={() => setBrowserOpen(true)}>
                    <FolderOpen size={16} /> Browse OpenCloud
                </button>
                <button className="secondary" onClick={onRefresh}>
                    <RefreshCw size={16} /> Check again
                </button>
            </div>
            {browserOpen && <OpenCloudBrowser onClose={() => setBrowserOpen(false)} />}
        </div>
    );
}

createRoot(document.getElementById('app')).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
