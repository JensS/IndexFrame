import {
    ArrowLeft,
    ArrowDownUp,
    Bookmark,
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
    FolderCog,
    Funnel,
    Grid3X3,
    Image as ImageIcon,
    LibraryBig,
    Link as LinkIcon,
    LoaderCircle,
    LogOut,
    Maximize,
    Menu,
    Minus,
    PanelLeft,
    PanelRight,
    Pause,
    Pin,
    Play,
    Plus,
    RefreshCw,
    Repeat,
    Search,
    Shuffle,
    Star,
    Shapes,
    Tags,
    Trash2,
    Upload,
    Volume2,
    VolumeX,
    Wifi,
    WifiOff,
    X,
} from 'lucide-react';
import { StrictMode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { buildJustifiedRows } from './justified-layout';

const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

async function sendServiceWorkerMessage(message, { onProgress = null, timeout = 300000 } = {}) {
    if (!('serviceWorker' in navigator)) {
        throw new Error('Offline storage needs HTTPS and a browser with service worker support.');
    }

    const registration = await navigator.serviceWorker.ready;
    const serviceWorker = navigator.serviceWorker.controller || registration.active;

    if (!serviceWorker) {
        throw new Error('Offline storage is still starting. Try again in a moment.');
    }

    return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = window.setTimeout(() => reject(new Error('Offline storage took too long to respond.')), timeout);

        channel.port1.onmessage = (event) => {
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
    if (!('serviceWorker' in navigator)) {
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
                .filter((key) => privateCachePrefixes.some((prefix) => key.startsWith(prefix)))
                .map((key) => caches.delete(key)),
        );

        const shellKey = cacheKeys.find(
            (key) => key.startsWith('indexframe-shell-') || key.startsWith('eagle-web-shell-'),
        );

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
        throw new Error(
            navigator.onLine
                ? 'The library could not reach the server.'
                : 'This view has not been cached for offline use yet.',
        );
    }

    if (response.status === 401) {
        window.location.assign('/login');

        return null;
    }

    const data = response.status === 204 ? null : await response.json().catch(() => null);

    if (!response.ok) {
        if (response.status === 413) {
            throw new Error(
                'These files exceed the upload limit. Add fewer files at a time or use the OpenCloud client.',
            );
        }

        const validationMessage = data?.errors ? Object.values(data.errors).flat()[0] : null;
        throw new Error(validationMessage || data?.message || 'Something went wrong.');
    }

    return data;
}

async function copyText(text) {
    if (!navigator.clipboard?.writeText) {
        throw new Error('Text copying needs HTTPS and clipboard access.');
    }

    await navigator.clipboard.writeText(text);
}

function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('The browser could not create a PNG image.'));

                return;
            }

            resolve(blob);
        }, 'image/png');
    });
}

async function copyPngBlob(blob) {
    if (!navigator.clipboard?.write || !window.ClipboardItem) {
        throw new Error('Image copying is not supported in this browser.');
    }

    await navigator.clipboard.write([new ClipboardItem({ 'image/png': Promise.resolve(blob) })]);
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

                if (!response.ok) {
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
    if (!bytes) {
        return '—';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);

    return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex > 1 ? 1 : 0)} ${units[unitIndex]}`;
}

function formatDuration(seconds) {
    if (!seconds) {
        return null;
    }

    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60)
        .toString()
        .padStart(2, '0');

    return `${minutes}:${remainder}`;
}

function formatDate(timestamp) {
    if (!timestamp) {
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
    return [...String(value)].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 0);
}

function assetMatchesSmartFolder(asset, smartFolder) {
    function matchesRule(rule) {
        const values = Array.isArray(rule.value) ? rule.value : [rule.value];

        if (rule.property === 'tags') {
            const tags = asset.tags || [];

            return rule.method === 'intersection'
                ? values.every((value) => tags.includes(value))
                : values.some((value) => tags.includes(value));
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

        if (!property) {
            return false;
        }

        const actual = asset[property];
        const expected = rule.value;

        if (rule.method === 'contain') {
            return String(actual || '')
                .toLocaleLowerCase()
                .includes(String(expected || '').toLocaleLowerCase());
        }

        if (rule.method === 'greater') {
            return Number(actual) > Number(expected);
        }

        if (rule.method === 'less') {
            return Number(actual) < Number(expected);
        }

        return String(actual || '').toLocaleLowerCase() === String(expected || '').toLocaleLowerCase();
    }

    return (smartFolder?.conditions || []).every((condition) => {
        const results = (condition.rules || []).map(matchesRule);
        const matches =
            String(condition.match || 'AND').toUpperCase() === 'OR' ? results.some(Boolean) : results.every(Boolean);

        return String(condition.boolean || 'TRUE').toUpperCase() === 'FALSE' ? !matches : matches;
    });
}

function filterOfflineAssets(allAssets, { navigation, search, selection, sort, type, advancedFilters = {} }) {
    const query = search.trim().toLocaleLowerCase();
    const smartFolder = selection.smart
        ? navigation?.smart_folders.find((folder) => folder.id === selection.smart)
        : null;
    const filtered = allAssets.filter((asset) => {
        if (advancedFilters.rating && asset.rating < Number(advancedFilters.rating)) {
            return false;
        }

        if (advancedFilters.shape) {
            if (!asset.width || !asset.height) {
                return false;
            }

            const ratio = asset.width / asset.height;
            const shape = ratio > 1.05 ? 'landscape' : ratio < 0.95 ? 'portrait' : 'square';

            if (shape !== advancedFilters.shape) {
                return false;
            }
        }

        if (advancedFilters.color) {
            const target = advancedFilters.color.match(/\w{2}/g).map((channel) => parseInt(channel, 16));
            const matches = (asset.palettes || []).some(
                (palette) =>
                    palette.color?.length === 3 &&
                    palette.color.reduce((distance, channel, index) => distance + (channel - target[index]) ** 2, 0) <
                        18000,
            );

            if (!matches) {
                return false;
            }
        }

        if (selection.view === 'trash' ? !asset.is_deleted : asset.is_deleted) {
            return false;
        }

        if (query) {
            const searchable = [asset.name, asset.annotation, asset.url, asset.extension, ...(asset.tags || [])]
                .filter(Boolean)
                .join(' ')
                .toLocaleLowerCase();

            if (!searchable.includes(query)) {
                return false;
            }
        }

        if (selection.view === 'uncategorized' && asset.folder_ids.length) {
            return false;
        }

        if (selection.view === 'untagged' && asset.tags.length) {
            return false;
        }

        if (selection.folder && !asset.folder_ids.includes(selection.folder)) {
            return false;
        }

        if (selection.smart && !assetMatchesSmartFolder(asset, smartFolder)) {
            return false;
        }

        if (selection.tag && !asset.tags.includes(selection.tag)) {
            return false;
        }

        return !type || asset.media_type === type;
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
    const [gridSize, setGridSize] = useState(145);
    const [advancedFilters, setAdvancedFilters] = useState({ color: '', shape: '', rating: '' });
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [filtersVisible, setFiltersVisible] = useState(true);
    const [navigationHistory, setNavigationHistory] = useState({ back: [], forward: [] });
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(true);
    const [draggingFiles, setDraggingFiles] = useState(false);
    const [installPrompt, setInstallPrompt] = useState(null);
    const [quickLookAsset, setQuickLookAsset] = useState(null);
    const [viewerAssetId, setViewerAssetId] = useState(null);
    const [assetMenu, setAssetMenu] = useState(null);
    const [shareLink, setShareLink] = useState(null);
    const [toast, setToast] = useState(null);
    const dragDepth = useRef(0);
    const fileInput = useRef(null);
    const viewerOpener = useRef(null);
    const offlineLibraryIndexes = useRef(new Map());
    const debouncedSearch = useDebouncedValue(search, 250);

    const activeLibrary = libraries.find((library) => library.slug === librarySlug);
    const selectedAsset = assets.find((asset) => asset.id === selectedAssetId) || null;
    const viewerAsset = assets.find((asset) => asset.id === viewerAssetId) || null;
    const viewerAssetIndex = assets.findIndex((asset) => asset.id === viewerAssetId);
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
            setLibrarySlug((current) => current || availableLibraries[0]?.slug || null);

            if (!availableLibraries.length) {
                setLoading(false);
            }
        } catch (error) {
            setLoading(false);
            flash(error.message, 'error');
        }
    }, [flash]);

    const loadNavigation = useCallback(async () => {
        if (!librarySlug) {
            return;
        }

        try {
            const response = await api(`/api/libraries/${librarySlug}/folders`);
            setNavigation(response.data);
        } catch (error) {
            flash(error.message, 'error');
        }
    }, [flash, librarySlug]);

    const loadOfflineLibraryIndex = useCallback(async (slug) => {
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

    const invalidateOfflineLibraryIndex = useCallback((slug) => {
        offlineLibraryIndexes.current.delete(slug);
    }, []);

    const loadAssets = useCallback(
        async ({ append = false, silent = false } = {}) => {
            if (!librarySlug) {
                return;
            }

            if (!silent) {
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
                        advancedFilters,
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

                if (!online || Object.values(advancedFilters).some(Boolean)) {
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

                setAssets((current) => (append ? [...current, ...nextAssets] : nextAssets));
                setMeta(nextMeta);
                setSelectedAssetId((current) => {
                    if (append || nextAssets.some((asset) => asset.id === current)) {
                        return current;
                    }

                    return window.innerWidth >= 1100 ? nextAssets[0]?.id || null : null;
                });
            } catch (error) {
                flash(error.message, 'error');
            } finally {
                if (!silent) {
                    setLoading(false);
                    setLoadingMore(false);
                }
            }
        },
        [
            advancedFilters,
            debouncedSearch,
            flash,
            librarySlug,
            loadOfflineLibraryIndex,
            navigation,
            online,
            page,
            selection,
            sort,
            type,
        ],
    );

    useEffect(() => {
        loadLibraries();
    }, [loadLibraries]);

    useEffect(() => {
        if (!('serviceWorker' in navigator)) {
            return;
        }

        navigator.serviceWorker
            .register('/sw.js', { scope: '/' })
            .then(() => navigator.serviceWorker.ready)
            .then(() => sendServiceWorkerMessage({ type: 'CACHE_APP_SHELL' }, { timeout: 30000 }))
            .catch(() => null);
    }, []);

    useEffect(() => {
        const handleInstallPrompt = (event) => {
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
        setNavigationHistory({ back: [], forward: [] });
        setAdvancedFilters({ color: '', shape: '', rating: '' });
        setSelection({ view: 'all', folder: null, smart: null, tag: null });
        setAssets([]);
        setPage(1);
        loadNavigation();
    }, [librarySlug, loadNavigation]);

    useEffect(() => {
        setPage(1);
    }, [advancedFilters, debouncedSearch, librarySlug, selection, sort, type]);

    useEffect(() => {
        loadAssets({ append: page > 1 });
    }, [loadAssets, page]);

    useEffect(() => {
        if (!online || !activeLibrary || activeLibrary.indexed_at) {
            return;
        }

        const interval = window.setInterval(() => {
            loadLibraries();
            loadAssets({ silent: true });
        }, 5000);

        return () => window.clearInterval(interval);
    }, [activeLibrary?.indexed_at, activeLibrary?.slug, loadAssets, loadLibraries, online]);

    function chooseNavigation(nextSelection) {
        setViewerAssetId(null);
        setNavigationHistory((current) => ({ back: [...current.back, selection], forward: [] }));
        setSelection({ view: 'all', folder: null, smart: null, tag: null, ...nextSelection });
        setSidebarOpen(false);
    }

    function navigateHistory(direction) {
        const entries = navigationHistory[direction];

        if (!entries.length) {
            return;
        }

        const other = direction === 'back' ? 'forward' : 'back';
        setSelection(entries[entries.length - 1]);
        setNavigationHistory((current) => ({
            [direction]: current[direction].slice(0, -1),
            [other]: [...current[other], selection],
        }));
    }

    function selectAsset(assetId) {
        setSelectedAssetId(assetId);
        setDetailsOpen(true);
    }

    function viewAsset(assetId, trigger) {
        if (!viewerAsset) {
            viewerOpener.current = { trigger, assetId };
            if (window.matchMedia('(max-width: 900px)').matches) {
                setDetailsOpen(false);
            }
        }

        setQuickLookAsset(null);
        setSidebarOpen(false);
        setSelectedAssetId(assetId);
        setViewerAssetId(assetId);
    }

    function closeViewer() {
        const opener = viewerOpener.current;
        setViewerAssetId(null);
        if (opener) {
            window.requestAnimationFrame(() => {
                const target = opener.trigger?.getClientRects().length
                    ? opener.trigger
                    : document.querySelector(`.asset-card[data-asset-id="${CSS.escape(opener.assetId)}"]`);
                target?.focus({ preventScroll: true });
            });
        }
    }

    function showSidebar() {
        setSidebarCollapsed(false);
        setSidebarOpen(true);
    }

    async function openShareLink(asset) {
        if (!online) {
            flash('Sharing needs an internet connection.', 'error');

            return;
        }

        const pending = { assetName: asset.name };
        setShareLink(pending);

        try {
            const response = await api(`/api/libraries/${librarySlug}/assets/${encodeURIComponent(asset.id)}/share`, {
                method: 'POST',
            });

            if (!response?.url) {
                throw new Error('The server did not return a share link.');
            }

            setShareLink((current) => (current === pending ? { ...pending, url: response.url } : current));
        } catch (error) {
            setShareLink((current) => (current === pending ? { ...pending, error: error.message } : current));
        }
    }

    async function uploadFiles(files) {
        if (!activeLibrary?.writes_enabled) {
            flash('This library is read-only.', 'error');

            return;
        }

        if (!files.length) {
            return;
        }

        if (!online) {
            flash('Uploads need an internet connection.', 'error');

            return;
        }

        if (files.length > 20) {
            flash('Add up to 20 assets at a time.', 'error');

            return;
        }

        const maximumBytes = (activeLibrary?.upload_max_kilobytes ?? 122880) * 1024;
        const requestMaximumBytes = (activeLibrary?.upload_request_max_kilobytes ?? 122880) * 1024;

        if (
            files.some((file) => file.size > maximumBytes) ||
            files.reduce((total, file) => total + file.size, 0) > requestMaximumBytes
        ) {
            flash(
                'These files exceed the upload limit. Add fewer files at a time or use the OpenCloud client.',
                'error',
            );

            return;
        }

        const formData = new FormData();
        files.forEach((file) => formData.append('files[]', file));

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
        if (!event.dataTransfer.types.includes('Files')) {
            return;
        }

        event.preventDefault();
        dragDepth.current += 1;
        setDraggingFiles(true);
    }

    function handleDragOver(event) {
        if (!event.dataTransfer.types.includes('Files')) {
            return;
        }

        event.preventDefault();
        event.dataTransfer.dropEffect = online ? 'copy' : 'none';
    }

    function handleDragLeave(event) {
        if (!event.dataTransfer.types.includes('Files')) {
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
        if (!installPrompt) {
            return;
        }

        await installPrompt.prompt();
        await installPrompt.userChoice;
        setInstallPrompt(null);
    }

    async function updateAsset(attributes) {
        if (!selectedAsset || !activeLibrary?.writes_enabled) {
            return;
        }

        if (!online) {
            flash('Changes are read-only while offline.', 'error');

            return;
        }

        try {
            const response = await api(`/api/libraries/${librarySlug}/assets/${selectedAsset.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(attributes),
            });
            setAssets((current) => current.map((asset) => (asset.id === selectedAsset.id ? response.data : asset)));
            await loadNavigation();
            flash('Asset updated');
        } catch (error) {
            flash(error.message, 'error');
        }
    }

    async function moveToTrash() {
        if (!selectedAsset || !activeLibrary?.writes_enabled) {
            return;
        }

        if (!online) {
            flash('Changes are read-only while offline.', 'error');

            return;
        }

        try {
            await api(`/api/libraries/${librarySlug}/assets/${selectedAsset.id}`, { method: 'DELETE' });
            setAssets((current) => current.filter((asset) => asset.id !== selectedAsset.id));
            setSelectedAssetId(null);
            await loadNavigation();
            flash('Moved to trash');
        } catch (error) {
            flash(error.message, 'error');
        }
    }

    const viewTitle = useMemo(() => {
        if (selection.folder) {
            return navigation?.folders.find((folder) => folder.id === selection.folder)?.name || 'Folder';
        }

        if (selection.smart) {
            return navigation?.smart_folders.find((folder) => folder.id === selection.smart)?.name || 'Smart folder';
        }

        if (selection.tag) {
            return `#${selection.tag}`;
        }

        return {
            all: 'All',
            uncategorized: 'Uncategorized',
            untagged: 'Untagged',
            recent: 'Recently used',
            random: 'Random',
            trash: 'Trash',
        }[selection.view];
    }, [navigation, selection]);

    if (!libraries.length && !loading) {
        return <EmptyLibraryState online={online} onRefresh={loadLibraries} />;
    }

    return (
        <div
            className={`app-shell ${detailsOpen && selectedAsset ? 'with-details' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
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
                onLibraryChange={(slug) => {
                    setViewerAssetId(null);
                    setLibrarySlug(slug);
                }}
                open={sidebarOpen}
                onUpload={() => fileInput.current?.click()}
                canWrite={online && activeLibrary?.writes_enabled}
                onToggle={() => setSidebarCollapsed(true)}
                onSort={() => setSort((current) => (current === 'newest' ? 'oldest' : 'newest'))}
            />

            <main className="workspace">
                <div className="gallery-workspace" hidden={Boolean(viewerAsset)}>
                    <Header
                        gridSize={gridSize}
                        libraryName={activeLibrary?.name}
                        online={online}
                        onGridSizeChange={setGridSize}
                        onMenu={() => setSidebarOpen(true)}
                        onUpload={() =>
                            online ? fileInput.current?.click() : flash('Uploads need an internet connection.', 'error')
                        }
                        search={search}
                        setSearch={setSearch}
                        uploading={uploading}
                        canWrite={online && activeLibrary?.writes_enabled}
                        viewTitle={viewTitle}
                        onInspector={() => setDetailsOpen((current) => !current)}
                        onFilters={() => setFiltersVisible((current) => !current)}
                        filtersVisible={filtersVisible}
                        onSidebar={showSidebar}
                        onSort={() => setSort((current) => (current === 'newest' ? 'oldest' : 'newest'))}
                        onBack={() => navigateHistory('back')}
                        onForward={() => navigateHistory('forward')}
                        canGoBack={navigationHistory.back.length > 0}
                        canGoForward={navigationHistory.forward.length > 0}
                    />

                    {filtersVisible && (
                        <FilterBar
                            onSort={setSort}
                            onType={setType}
                            sort={sort}
                            type={type}
                            viewTitle={viewTitle}
                            visibleCount={meta.total}
                            navigation={navigation}
                            selection={selection}
                            onChoose={chooseNavigation}
                            advancedFilters={advancedFilters}
                            onAdvancedChange={setAdvancedFilters}
                        />
                    )}

                    <AssetGrid
                        assets={assets}
                        gridSize={gridSize}
                        loading={loading}
                        onContextMenu={setAssetMenu}
                        onLoadMore={() => setPage((current) => current + 1)}
                        onSelect={selectAsset}
                        onQuickLook={setQuickLookAsset}
                        onView={viewAsset}
                        canLoadMore={meta.current_page < meta.last_page}
                        loadingMore={loadingMore}
                        indexing={!activeLibrary?.indexed_at}
                        selectedAssetId={selectedAssetId}
                    />
                </div>
                {viewerAsset && (
                    <AssetViewer
                        asset={viewerAsset}
                        position={viewerAssetIndex + 1}
                        total={meta.total}
                        canMoveNext={viewerAssetIndex < assets.length - 1}
                        canMovePrevious={viewerAssetIndex > 0}
                        detailsOpen={detailsOpen}
                        online={online}
                        onClose={closeViewer}
                        onInspector={() => setDetailsOpen((current) => !current)}
                        onShare={() => openShareLink(viewerAsset)}
                        onSidebar={showSidebar}
                        onMoveNext={() => viewAsset(assets[viewerAssetIndex + 1].id)}
                        onMovePrevious={() => viewAsset(assets[viewerAssetIndex - 1].id)}
                    />
                )}
            </main>

            {selectedAsset && detailsOpen && (
                <DetailsPanel
                    asset={selectedAsset}
                    folders={navigation?.folders || []}
                    onClose={() => setDetailsOpen(false)}
                    onDelete={moveToTrash}
                    onShare={() => openShareLink(selectedAsset)}
                    onView={(trigger) => viewAsset(selectedAsset.id, trigger)}
                    onUpdate={updateAsset}
                    online={online}
                    canWrite={online && activeLibrary?.writes_enabled}
                    viewing={Boolean(viewerAsset)}
                />
            )}

            {sidebarOpen && (
                <button className="mobile-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close menu" />
            )}
            <input ref={fileInput} hidden type="file" multiple accept="image/*,video/*" onChange={handleUpload} />
            {quickLookAsset && !viewerAsset && !assetMenu && !shareLink && <QuickLook asset={quickLookAsset} />}
            {assetMenu && (
                <AssetContextMenu
                    key={assetMenu.openedAt}
                    menu={assetMenu}
                    onClose={() => setAssetMenu((current) => (current === assetMenu ? null : current))}
                    onShare={() => openShareLink(assetMenu.asset)}
                />
            )}
            {shareLink && <ShareLinkDialog share={shareLink} onClose={() => setShareLink(null)} />}
            {draggingFiles && (
                <DropOverlay
                    destination={
                        navigation?.folders.find((folder) => folder.id === currentFolderId)?.name || activeLibrary?.name
                    }
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
    onUpload,
    canWrite,
    onToggle,
    onSort,
}) {
    const [filter, setFilter] = useState('');
    const [showTags, setShowTags] = useState(false);
    const matches = (name) => name.toLocaleLowerCase().includes(filter.toLocaleLowerCase());
    const standardViews = [
        { key: 'all', label: 'All', icon: Grid3X3, count: navigation?.counts.all },
        { key: 'uncategorized', label: 'Uncategorized', icon: FolderOpen, count: navigation?.counts.uncategorized },
        { key: 'untagged', label: 'Untagged', icon: Bookmark, count: navigation?.counts.untagged },
        { key: 'recent', label: 'Recently Used', icon: Clock3 },
        { key: 'random', label: 'Random', icon: Shuffle },
    ];

    return (
        <aside className={`sidebar ${open ? 'open' : ''}`}>
            <div className="window-toolbar">
                <div className="traffic-lights" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                </div>
                <div className="window-tools">
                    <button
                        className="native-icon"
                        onClick={onUpload}
                        disabled={!canWrite}
                        aria-label="Upload assets"
                        title={canWrite ? 'Add assets' : 'Library is read-only'}
                    >
                        <Plus />
                    </button>
                    <button
                        className="native-icon"
                        onClick={onSort}
                        aria-label="Reverse sort order"
                        title="Reverse sort order"
                    >
                        <ArrowDownUp />
                    </button>
                    <button className="native-icon" onClick={onToggle} aria-label="Hide sidebar" title="Hide sidebar">
                        <PanelLeft />
                    </button>
                </div>
            </div>
            <div className="library-select-wrap">
                <span className="library-app-icon">
                    <LibraryBig size={16} />
                </span>
                <select
                    aria-label="Library"
                    value={activeLibrary?.slug || ''}
                    onChange={(event) => onLibraryChange(event.target.value)}
                >
                    {libraries.map((library) => (
                        <option value={library.slug} key={library.slug}>
                            {library.name}
                        </option>
                    ))}
                </select>
                <ChevronDown size={13} />
            </div>
            <nav className="sidebar-scroll" aria-label="Library navigation">
                <div className="nav-group standard-views">
                    {standardViews.map((item) => (
                        <SidebarItem
                            active={current.view === item.key && !current.folder && !current.smart && !current.tag}
                            count={item.count}
                            icon={item.icon}
                            key={item.key}
                            label={item.label}
                            onClick={() => onChoose({ view: item.key })}
                        />
                    ))}
                    <SidebarItem
                        active={showTags}
                        icon={Bookmark}
                        label="All Tags"
                        onClick={() => setShowTags((current) => !current)}
                    />
                    <SidebarItem
                        active={current.view === 'trash'}
                        count={navigation?.counts.trash}
                        icon={Trash2}
                        label="Trash"
                        onClick={() => onChoose({ view: 'trash' })}
                    />
                </div>
                {showTags && (
                    <div className="nav-group tag-browser">
                        <p className="nav-heading">Popular Tags</p>
                        {(navigation?.tags || [])
                            .filter((tag) => matches(tag.name))
                            .map((tag) => (
                                <SidebarItem
                                    active={current.tag === tag.name}
                                    count={tag.count}
                                    icon={Bookmark}
                                    key={tag.name}
                                    label={tag.name}
                                    onClick={() => onChoose({ tag: tag.name })}
                                />
                            ))}
                    </div>
                )}
                {!!navigation?.smart_folders.length && (
                    <div className="nav-group">
                        <p className="nav-heading">Smart Folders ({navigation.smart_folders.length})</p>
                        {navigation.smart_folders
                            .filter((folder) => matches(folder.name))
                            .map((folder) => (
                                <SidebarItem
                                    active={current.smart === folder.id}
                                    count={folder.count}
                                    icon={FolderCog}
                                    key={folder.id}
                                    label={folder.name}
                                    onClick={() => onChoose({ smart: folder.id })}
                                />
                            ))}
                    </div>
                )}
                {!!navigation?.folders.length && (
                    <div className="nav-group">
                        <p className="nav-heading">Folders ({navigation.folders.length})</p>
                        {navigation.folders
                            .filter((folder) => matches(folder.name))
                            .map((folder) => (
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
            </nav>
            <div className="sidebar-footer">
                {activeLibrary && (
                    <details className="offline-menu">
                        <summary>
                            <CloudDownload size={15} />
                            <span>Offline library</span>
                            <ChevronDown size={12} />
                        </summary>
                        <OfflineLibraryControl
                            library={activeLibrary}
                            online={online}
                            onIndexChange={onOfflineLibraryChange}
                        />
                    </details>
                )}
                <label className="sidebar-filter">
                    <Funnel size={16} />
                    <input
                        aria-label="Filter folders and tags"
                        placeholder="Filter"
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                    />
                    {filter && (
                        <button onClick={() => setFilter('')} aria-label="Clear sidebar filter">
                            <X size={13} />
                        </button>
                    )}
                </label>
                <div className="sidebar-utilities">
                    {onInstall && (
                        <button onClick={onInstall}>
                            <Download size={13} /> Install app
                        </button>
                    )}
                    <form
                        action="/logout"
                        method="POST"
                        onSubmit={async (event) => {
                            event.preventDefault();
                            const form = event.currentTarget;
                            await clearOfflineData();
                            navigator.onLine ? form.submit() : window.location.assign('/login');
                        }}
                    >
                        <input type="hidden" name="_token" value={csrfToken} />
                        <button>
                            <LogOut size={13} /> Lock archive
                        </button>
                    </form>
                </div>
            </div>
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
        if (!navigator.storage?.estimate) {
            return;
        }

        setStorage(await navigator.storage.estimate());
    }, []);

    const refreshStatus = useCallback(async () => {
        setStatus(undefined);
        setError(null);

        if (!supported) {
            setStatus(null);
            setError('Offline storage needs HTTPS and a browser with service worker support.');

            return;
        }

        try {
            const result = await sendServiceWorkerMessage(
                {
                    type: 'GET_LIBRARY_CACHE_STATUS',
                    library: library.slug,
                },
                { timeout: 10000 },
            );
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
        setStatus((current) => ({
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

            const result = await sendServiceWorkerMessage(
                {
                    type: 'CACHE_LIBRARY',
                    library: library.slug,
                },
                {
                    onProgress: setStatus,
                    timeout: 86400000,
                },
            );
            setStatus(result.status || null);
            onIndexChange(library.slug);
            await refreshStorage();
        } catch (caughtError) {
            setStatus((current) => (current ? { ...current, state: 'partial' } : null));
            setError(caughtError.message);
            await refreshStorage();
        }
    }

    async function pause() {
        try {
            await sendServiceWorkerMessage(
                {
                    type: 'CANCEL_LIBRARY_CACHE',
                    library: library.slug,
                },
                { timeout: 10000 },
            );
        } catch (caughtError) {
            setError(caughtError.message);
        }
    }

    async function remove() {
        setError(null);

        try {
            await sendServiceWorkerMessage(
                {
                    type: 'REMOVE_LIBRARY_CACHE',
                    library: library.slug,
                },
                { timeout: 300000 },
            );
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
    const percentage = status?.total ? Math.min(100, Math.round((status.processed / status.total) * 100)) : 0;
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

            {status?.downloaded_bytes > 0 && <p>{formatBytes(status.downloaded_bytes)} cached for this library</p>}
            {status?.skipped > 0 && (
                <p className="offline-library-error">
                    {formatNumber(status.skipped)} unavailable {status.skipped === 1 ? 'preview was' : 'previews were'}{' '}
                    skipped
                </p>
            )}
            {storage?.quota > 0 && (
                <p>
                    {formatBytes(storage.usage)} of {formatBytes(storage.quota)} browser storage used
                </p>
            )}
            {error && <p className="offline-library-error">{error}</p>}

            <div className="offline-library-actions">
                {caching ? (
                    <button onClick={pause}>
                        <X size={13} /> Pause
                    </button>
                ) : (
                    <button disabled={!online || !supported || status === undefined} onClick={save}>
                        {partial ? <RefreshCw size={13} /> : <CloudDownload size={13} />}
                        {partial ? 'Resume' : ready ? 'Refresh' : 'Save offline'}
                    </button>
                )}
                {(ready || partial) && (
                    <button className="quiet" onClick={remove}>
                        Remove
                    </button>
                )}
            </div>
        </section>
    );
}

function Header({
    gridSize,
    online,
    onGridSizeChange,
    onUpload,
    search,
    setSearch,
    uploading,
    canWrite,
    viewTitle,
    onInspector,
    onFilters,
    filtersVisible,
    onSidebar,
    onSort,
    onBack,
    onForward,
    canGoBack,
    canGoForward,
}) {
    return (
        <header className="workspace-header">
            <div className="header-title">
                <button className="native-icon sidebar-reveal" onClick={onSidebar} aria-label="Show sidebar">
                    <PanelLeft />
                </button>
                <button className="native-icon" onClick={onBack} disabled={!canGoBack} aria-label="Back">
                    <ChevronLeft />
                </button>
                <button className="native-icon" onClick={onForward} disabled={!canGoForward} aria-label="Forward">
                    <ChevronRight />
                </button>
                <h1>{viewTitle}</h1>
            </div>
            <div className="grid-slider">
                <button
                    className="native-icon"
                    aria-label="Smaller thumbnails"
                    onClick={() => onGridSizeChange(Math.max(90, gridSize - 15))}
                >
                    <Minus size={13} />
                </button>
                <input
                    aria-label="Thumbnail size"
                    max="250"
                    min="90"
                    type="range"
                    value={gridSize}
                    onChange={(event) => onGridSizeChange(Number(event.target.value))}
                />
                <button
                    className="native-icon"
                    aria-label="Larger thumbnails"
                    onClick={() => onGridSizeChange(Math.min(250, gridSize + 15))}
                >
                    <Plus size={13} />
                </button>
            </div>
            <div className="header-actions">
                {!online && (
                    <span className="connection-status offline" title="Browsing offline">
                        <WifiOff size={15} />
                    </span>
                )}
                <button
                    className="native-icon desktop-only"
                    onClick={onUpload}
                    disabled={uploading || !canWrite}
                    aria-label="Upload assets"
                    title={canWrite ? 'Add assets' : 'Library is read-only'}
                >
                    {uploading ? <LoaderCircle className="spin" /> : <Plus />}
                </button>
                <button
                    className="native-icon desktop-only"
                    onClick={onSort}
                    aria-label="Reverse sort order"
                    title="Reverse sort order"
                >
                    <ArrowDownUp />
                </button>
                <button
                    className="native-icon"
                    onClick={onInspector}
                    aria-label="Toggle inspector"
                    title="Toggle inspector"
                >
                    <PanelRight />
                </button>
                <button
                    className={`native-icon ${filtersVisible ? 'pressed' : ''}`}
                    onClick={onFilters}
                    aria-label="Toggle filters"
                    aria-pressed={filtersVisible}
                    title="Show filters"
                >
                    <Funnel />
                </button>
                <label className="search-field">
                    <Search size={19} />
                    <input
                        aria-label="Search library"
                        placeholder="Search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                    {search && (
                        <button onClick={() => setSearch('')} aria-label="Clear search">
                            <X size={14} />
                        </button>
                    )}
                </label>
            </div>
        </header>
    );
}

function FilterSelect({ icon: Icon, label, value, onChange, children }) {
    return (
        <label className={`native-filter ${value ? 'active' : ''}`}>
            <Icon size={17} />
            <span>{label}</span>
            <select aria-label={label} value={value || ''} onChange={(event) => onChange(event.target.value)}>
                {children}
            </select>
        </label>
    );
}

function FilterBar({
    onSort,
    onType,
    sort,
    type,
    visibleCount,
    navigation,
    selection,
    onChoose,
    advancedFilters,
    onAdvancedChange,
}) {
    const [colorOpen, setColorOpen] = useState(false);
    const colors = [
        'e74c3c',
        'e99b43',
        'ead34d',
        '6eaa63',
        '65bebb',
        '4b8ed6',
        '9471c5',
        'd180a5',
        '9a7059',
        'ffffff',
        'aaaaaa',
        '333333',
    ];
    function setAdvanced(key, value) {
        onAdvancedChange((current) => ({ ...current, [key]: value }));
    }
    const filtered = type || selection.tag || selection.folder || Object.values(advancedFilters).some(Boolean);
    return (
        <div className="filter-bar">
            <div className="native-filters">
                <div className="color-filter-wrap">
                    <button
                        className={`native-filter ${advancedFilters.color ? 'active' : ''}`}
                        onClick={() => setColorOpen((current) => !current)}
                        aria-expanded={colorOpen}
                    >
                        <span className="color-wheel" />
                        <span>Color</span>
                    </button>
                    {colorOpen && (
                        <div className="color-popover">
                            <p>Color</p>
                            <div>
                                {colors.map((color) => (
                                    <button
                                        key={color}
                                        aria-label={`Filter color #${color}`}
                                        style={{ backgroundColor: `#${color}` }}
                                        onClick={() => {
                                            setAdvanced('color', color);
                                            setColorOpen(false);
                                        }}
                                    />
                                ))}
                            </div>
                            <button
                                className="clear-color"
                                onClick={() => {
                                    setAdvanced('color', '');
                                    setColorOpen(false);
                                }}
                            >
                                Any color
                            </button>
                        </div>
                    )}
                </div>
                <FilterSelect
                    icon={Bookmark}
                    label="Tags"
                    value={selection.tag}
                    onChange={(tag) => onChoose({ tag: tag || null })}
                >
                    <option value="">All tags</option>
                    {navigation?.tags.map((tag) => (
                        <option value={tag.name} key={tag.name}>
                            {tag.name} ({formatNumber(tag.count)})
                        </option>
                    ))}
                </FilterSelect>
                <FilterSelect
                    icon={Folder}
                    label="Folder"
                    value={selection.folder}
                    onChange={(folder) => onChoose({ folder: folder || null })}
                >
                    <option value="">All folders</option>
                    {navigation?.folders.map((folder) => (
                        <option value={folder.id} key={folder.id}>
                            {folder.name}
                        </option>
                    ))}
                </FilterSelect>
                <FilterSelect
                    icon={Shapes}
                    label="Shape"
                    value={advancedFilters.shape}
                    onChange={(shape) => setAdvanced('shape', shape)}
                >
                    <option value="">Any shape</option>
                    <option value="landscape">Landscape</option>
                    <option value="portrait">Portrait</option>
                    <option value="square">Square</option>
                </FilterSelect>
                <FilterSelect
                    icon={Star}
                    label="Rating"
                    value={advancedFilters.rating}
                    onChange={(rating) => setAdvanced('rating', rating)}
                >
                    <option value="">Any rating</option>
                    {[1, 2, 3, 4, 5].map((rating) => (
                        <option key={rating} value={rating}>
                            {'★'.repeat(rating)} and up
                        </option>
                    ))}
                </FilterSelect>
                <FilterSelect icon={FileQuestion} label="Types" value={type} onChange={onType}>
                    <option value="">All types</option>
                    <option value="image">Images</option>
                    <option value="video">Videos</option>
                    <option value="other">Other</option>
                </FilterSelect>
                {filtered && (
                    <button
                        className="native-icon clear-filters"
                        aria-label="Clear filters"
                        title="Clear filters"
                        onClick={() => {
                            onAdvancedChange({ color: '', shape: '', rating: '' });
                            onType('');
                            onChoose({});
                        }}
                    >
                        <X size={15} />
                    </button>
                )}
            </div>
            <div className="filter-summary">
                <span>{formatNumber(visibleCount)}</span>
                <select aria-label="Sort assets" value={sort} onChange={(event) => onSort(event.target.value)}>
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="name">Name</option>
                </select>
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
    onContextMenu,
    onLoadMore,
    onQuickLook,
    onSelect,
    onView,
    selectedAssetId,
}) {
    const gridElement = useRef(null);
    const [width, setWidth] = useState(800);
    const rows = useMemo(() => buildJustifiedRows(assets, width, gridSize), [assets, width, gridSize]);

    useEffect(() => {
        if (!gridElement.current) {
            return;
        }

        const observer = new ResizeObserver(([entry]) => {
            if (entry.contentRect.width > 0) {
                setWidth(entry.contentRect.width);
            }
        });
        observer.observe(gridElement.current);

        return () => observer.disconnect();
    }, [loading, assets.length === 0]);

    if (loading) {
        return (
            <div className="loading-grid" style={{ '--grid-size': `${gridSize}px` }}>
                {Array.from({ length: 18 }).map((_, index) => (
                    <div className="skeleton-card" key={index} />
                ))}
            </div>
        );
    }

    if (!assets.length) {
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
            <div className="asset-grid" ref={gridElement}>
                {rows.map((row) => (
                    <div
                        className="asset-row"
                        key={row.items[0].asset.id}
                        style={{ '--row-height': `${row.height}px` }}
                    >
                        {row.items.map(({ asset, width: cardWidth }) => (
                            <AssetCard
                                asset={asset}
                                width={cardWidth}
                                key={asset.id}
                                onClick={() => onSelect(asset.id)}
                                onContextMenu={onContextMenu}
                                onQuickLook={onQuickLook}
                                onView={(trigger) => onView(asset.id, trigger)}
                                selected={selectedAssetId === asset.id}
                            />
                        ))}
                    </div>
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

function AssetCard({ asset, width, onClick, onContextMenu, onQuickLook, onView, selected }) {
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

    function openContextMenu(event, fromKeyboard = false) {
        if (asset.is_deleted) {
            return;
        }

        event.preventDefault();
        stopQuickLook();
        const trigger = event.currentTarget;
        const bounds = trigger.getBoundingClientRect();
        onContextMenu({
            asset,
            trigger,
            openedAt: event.timeStamp,
            x: fromKeyboard ? bounds.left : event.clientX,
            y: fromKeyboard ? bounds.bottom : event.clientY,
        });
    }

    useEffect(() => () => window.clearTimeout(quickLookTimer.current), []);

    return (
        <button
            className={`asset-card ${selected ? 'selected' : ''}`}
            data-asset-id={asset.id}
            style={{ width }}
            onClick={onClick}
            onContextMenu={(event) => openContextMenu(event, event.clientX === 0 && event.clientY === 0)}
            onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.repeat) {
                    event.preventDefault();
                    stopQuickLook();
                    onView(event.currentTarget);
                }
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    openContextMenu(event, true);
                }
            }}
            aria-haspopup={asset.is_deleted ? undefined : 'menu'}
            aria-keyshortcuts={asset.is_deleted ? 'Enter' : 'Enter Shift+F10'}
            onDoubleClick={(event) => {
                stopQuickLook();
                onView(event.currentTarget);
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
                {!['JPG', 'JPEG', 'PNG'].includes(asset.extension) && (
                    <span className="asset-type">{asset.extension}</span>
                )}
            </div>
            <div className="asset-caption">
                <strong>
                    <span className="asset-name">
                        {asset.name.toLocaleLowerCase().endsWith(`.${asset.extension.toLowerCase()}`)
                            ? asset.name
                            : `${asset.name}.${asset.extension.toLowerCase()}`}
                    </span>
                </strong>
                <span>
                    {asset.media_type === 'video' && asset.duration
                        ? formatDuration(asset.duration)
                        : asset.width && asset.height
                          ? `${asset.width} × ${asset.height}`
                          : formatBytes(asset.size)}
                </span>
            </div>
        </button>
    );
}

function AssetContextMenu({ menu, onClose, onShare }) {
    const anchor = useRef(null);
    const popover = useRef(null);
    const shareButton = useRef(null);
    const hasPopover = 'popover' in HTMLElement.prototype;
    const hasFocusGroup = 'focusGroup' in HTMLElement.prototype;

    useLayoutEffect(() => {
        const element = popover.current;
        menu.trigger.focus({ preventScroll: true });

        if (hasPopover && !element.matches(':popover-open')) {
            element.showPopover({ source: anchor.current });
        }

        const hasAnchorPositioning =
            window.ToggleEvent && 'source' in ToggleEvent.prototype && CSS.supports('position-area: block-end');

        if (!hasPopover || !hasAnchorPositioning) {
            const { width, height } = element.getBoundingClientRect();
            element.classList.add('positioned');
            const left = menu.x + width + 4 > window.innerWidth ? menu.x - width : menu.x;
            const top = menu.y + height + 4 > window.innerHeight ? menu.y - height : menu.y;
            element.style.left = `${Math.max(4, left)}px`;
            element.style.top = `${Math.max(4, top)}px`;
        }

        shareButton.current.focus({ preventScroll: true });
    }, [hasPopover, menu]);

    useEffect(() => {
        function dismissOutside(event) {
            if (!popover.current?.contains(event.target)) {
                onClose();
            }
        }

        document.addEventListener('pointerdown', dismissOutside);
        document.addEventListener('focusin', dismissOutside);

        return () => {
            document.removeEventListener('pointerdown', dismissOutside);
            document.removeEventListener('focusin', dismissOutside);
        };
    }, [onClose]);

    function closeAndRestoreFocus() {
        menu.trigger.focus({ preventScroll: true });
        onClose();
    }

    function handleMenuKey(event) {
        if (event.key === 'Escape' || event.key === 'Tab') {
            if (event.key === 'Escape') {
                event.preventDefault();
            }

            closeAndRestoreFocus();
        } else if (!hasFocusGroup && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
        }
    }

    return (
        <>
            <span ref={anchor} className="asset-menu-anchor" style={{ left: menu.x, top: menu.y }} aria-hidden="true" />
            {/* An auto popover dismisses on the pointer release that follows the right-click. */}
            <div
                ref={popover}
                className="asset-context-menu"
                popover={hasPopover ? 'manual' : undefined}
                onKeyDown={handleMenuKey}
            >
                <div focusgroup="menu nomemory" role={hasFocusGroup ? undefined : 'menu'} aria-label="Asset actions">
                    <button
                        ref={shareButton}
                        type="button"
                        role={hasFocusGroup ? undefined : 'menuitem'}
                        onClick={() => {
                            closeAndRestoreFocus();
                            onShare();
                        }}
                    >
                        <LinkIcon size={15} aria-hidden="true" /> Share link
                    </button>
                </div>
            </div>
        </>
    );
}

function ShareLinkDialog({ share, onClose }) {
    const dialog = useRef(null);
    const linkField = useRef(null);
    const copyButton = useRef(null);
    const [copyStatus, setCopyStatus] = useState('');
    const { assetName, url, error } = share;

    useLayoutEffect(() => {
        if (!dialog.current.open) {
            dialog.current.showModal();
        }
    }, []);

    useEffect(() => {
        if (!url) {
            return;
        }

        const button = copyButton.current;
        const field = linkField.current;
        const usesCommands = 'commandForElement' in HTMLButtonElement.prototype;
        const target = usesCommands ? field : button;
        const eventName = usesCommands ? 'command' : 'click';
        let timer;

        async function copyLink() {
            window.clearTimeout(timer);

            try {
                await copyText(field.value);
                setCopyStatus('Link copied');
                timer = window.setTimeout(() => setCopyStatus(''), 2500);
            } catch {
                field.focus();
                field.select();
                setCopyStatus('Copy unavailable. Select and copy the link manually.');
            }
        }

        target.addEventListener(eventName, copyLink);

        return () => {
            target.removeEventListener(eventName, copyLink);
            window.clearTimeout(timer);
        };
    }, [url]);

    return (
        <dialog ref={dialog} className="share-link-dialog" aria-labelledby="share-link-title" onClose={onClose}>
            <header>
                <h2 id="share-link-title">Share link</h2>
                <form method="dialog">
                    <button className="native-icon" aria-label="Close share link" autoFocus>
                        <X size={18} aria-hidden="true" />
                    </button>
                </form>
            </header>
            <p><strong>{assetName}</strong></p>
            {url && (
                <>
                    <p>Anyone with this link can view and download this asset.</p>
                    <div className="share-link-field">
                        <input id="asset-share-url" ref={linkField} aria-label="Public asset link" value={url} readOnly />
                        <button ref={copyButton} type="button" command="--copy" commandfor="asset-share-url">
                            {copyStatus === 'Link copied' ? <Check size={16} /> : <Copy size={16} />}
                            Copy link
                        </button>
                    </div>
                    <p className="share-link-status" role="status">{copyStatus}</p>
                </>
            )}
            {!url && <p role="status">{error || 'Creating link…'}</p>}
        </dialog>
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
    position,
    total,
    canMoveNext,
    canMovePrevious,
    detailsOpen,
    online,
    onClose,
    onInspector,
    onMoveNext,
    onMovePrevious,
    onShare,
    onSidebar,
}) {
    const [copyStatus, setCopyStatus] = useState('idle');
    const [copyError, setCopyError] = useState(null);
    const [offlineVideo, setOfflineVideo] = useState(null);
    const video = useRef(null);
    const viewer = useRef(null);
    const backButton = useRef(null);
    const isVideo = asset.media_type === 'video';
    const offlineVideoSaved = offlineVideo?.url === asset.original_url ? offlineVideo.saved : null;
    const canPlayVideo = online || offlineVideoSaved;

    useLayoutEffect(() => {
        backButton.current.focus({ preventScroll: true });
    }, []);

    useEffect(() => {
        setCopyStatus('idle');
        setCopyError(null);
    }, [asset.id]);

    useEffect(() => {
        if (online || !isVideo) {
            return;
        }

        let active = true;
        const url = asset.original_url;
        sendServiceWorkerMessage({ type: 'CHECK_ASSET', url }, { timeout: 10000 })
            .then(({ cached }) => active && setOfflineVideo({ url, saved: cached }))
            .catch(() => active && setOfflineVideo({ url, saved: false }));

        return () => {
            active = false;
        };
    }, [asset.original_url, isVideo, online]);

    function handleKeyDown(event) {
        if (event.key === 'Escape' && !document.fullscreenElement) {
            onClose();
        }

        if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, select, video')) {
            return;
        }

        if (event.key === 'ArrowLeft' && canMovePrevious) {
            onMovePrevious();
        }

        if (event.key === 'ArrowRight' && canMoveNext) {
            onMoveNext();
        }
    }

    async function copyCurrentAsset() {
        setCopyStatus('copying');
        setCopyError(null);

        try {
            if (isVideo) {
                const currentVideo = video.current;

                if (!currentVideo?.videoWidth || currentVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
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
        <section className="asset-viewer" ref={viewer} aria-label="Asset viewer" onKeyDown={handleKeyDown}>
            <header className="asset-viewer-header">
                <button
                    className="native-icon sidebar-reveal"
                    onClick={onSidebar}
                    aria-label="Show sidebar"
                    title="Show sidebar"
                >
                    <PanelLeft size={17} aria-hidden="true" />
                </button>
                <button
                    ref={backButton}
                    className="native-icon"
                    onClick={onClose}
                    aria-label="Back to gallery"
                    title="Back to gallery"
                >
                    <ArrowLeft size={18} aria-hidden="true" />
                </button>
                <div className="asset-viewer-title">
                    <h1>{asset.name}</h1>
                    <span>{formatNumber(position)} of {formatNumber(total)}</span>
                </div>
                <div className="asset-viewer-actions">
                    <button
                        className="native-icon"
                        aria-label={isVideo ? 'Copy current frame' : 'Copy image'}
                        title={isVideo ? 'Copy current frame' : 'Copy image'}
                        disabled={copyStatus === 'copying' || (isVideo && !canPlayVideo)}
                        onClick={copyCurrentAsset}
                    >
                        {copyStatus === 'copying' && <LoaderCircle className="spin" size={16} aria-hidden="true" />}
                        {copyStatus === 'copied' && <Check size={16} aria-hidden="true" />}
                        {copyStatus === 'idle' && (isVideo
                            ? <Camera size={16} aria-hidden="true" />
                            : <Copy size={16} aria-hidden="true" />)}
                    </button>
                    {!asset.is_deleted && (
                        <button
                            className="native-icon"
                            title="Share link"
                            aria-label="Share link"
                            disabled={!online}
                            onClick={onShare}
                        >
                            <LinkIcon size={16} aria-hidden="true" />
                        </button>
                    )}
                    <a
                        className="native-icon"
                        href={asset.download_url}
                        download
                        aria-label="Download original"
                        title="Download original"
                    >
                        <Download size={16} aria-hidden="true" />
                    </a>
                    <button
                        className="native-icon"
                        onClick={onInspector}
                        aria-label="Inspector"
                        aria-pressed={detailsOpen}
                        title="Inspector"
                    >
                        <PanelRight size={17} aria-hidden="true" />
                    </button>
                    <div className="asset-viewer-navigation">
                        <button
                            className="native-icon"
                            disabled={!canMovePrevious}
                            onClick={onMovePrevious}
                            aria-label="Previous asset"
                            title="Previous asset"
                        >
                            <ChevronLeft size={18} aria-hidden="true" />
                        </button>
                        <button
                            className="native-icon"
                            disabled={!canMoveNext}
                            onClick={onMoveNext}
                            aria-label="Next asset"
                            title="Next asset"
                        >
                            <ChevronRight size={18} aria-hidden="true" />
                        </button>
                    </div>
                </div>
            </header>
            <div className="asset-viewer-status" role="status">
                {copyError || (copyStatus === 'copied' ? 'Copied to clipboard' : '')}
            </div>

            {isVideo && canPlayVideo ? (
                <ViewerVideo key={asset.id} asset={asset} video={video} viewer={viewer} />
            ) : (
                <div className="asset-viewer-media">
                    <img
                        src={asset.viewer_url || asset.preview_url}
                        alt={asset.name}
                        onError={(event) => {
                            const previewUrl = new URL(asset.preview_url, window.location.origin).href;

                            if (event.currentTarget.src !== previewUrl) {
                                event.currentTarget.src = asset.preview_url;
                            }
                        }}
                    />
                    {isVideo && (
                        <p className="asset-viewer-message" role="status">
                            {offlineVideoSaved === null
                                ? 'Checking offline video…'
                                : 'Save this video individually to play it offline.'}
                        </p>
                    )}
                </div>
            )}
        </section>
    );
}

function ViewerVideo({ asset, video, viewer }) {
    const [playback, setPlayback] = useState({ time: 0, duration: 0, paused: true, muted: false, rate: 1 });
    const [loop, setLoop] = useState(false);
    const [error, setError] = useState('');
    const [mediaFailed, setMediaFailed] = useState(false);
    const { time, duration, paused, muted, rate } = playback;
    const totalTime = formatDuration(duration || asset.duration) || '—';
    const currentTime = formatDuration(time) || '0:00';
    const hasFullscreen = document.fullscreenEnabled || 'webkitEnterFullscreen' in HTMLVideoElement.prototype;

    function syncPlayback(event) {
        const media = event.currentTarget;
        setPlayback({
            time: media.currentTime,
            duration: Number.isFinite(media.duration) ? media.duration : 0,
            paused: media.paused,
            muted: media.muted,
            rate: media.playbackRate,
        });
    }

    async function togglePlayback() {
        const media = video.current;
        setError('');

        if (!media.paused) {
            media.pause();

            return;
        }

        try {
            await media.play();
        } catch (exception) {
            if (exception.name !== 'AbortError') {
                setError('Playback could not start. Try downloading the original.');
            }
        }
    }

    async function toggleFullscreen() {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            } else if (document.fullscreenEnabled) {
                await viewer.current.requestFullscreen();
            } else {
                video.current.webkitEnterFullscreen();
            }
        } catch {
            setError('Fullscreen is unavailable for this video.');
        }
    }

    function seekTo(seconds) {
        const nextTime = Math.max(0, Math.min(seconds, duration));
        video.current.currentTime = nextTime;
        setPlayback((current) => ({ ...current, time: nextTime }));
    }

    function seekWithArrowKeys(event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
            return;
        }

        event.preventDefault();
        const step = event.key === 'ArrowRight' ? 1 : -1;
        seekTo(video.current.currentTime + step);
    }

    return (
        <>
            <div className="asset-viewer-media">
                <video
                    ref={video}
                    playsInline
                    loop={loop}
                    poster={asset.viewer_url || asset.preview_url}
                    preload="metadata"
                    src={asset.original_url}
                    width={asset.width || 640}
                    height={asset.height || 360}
                    aria-label={asset.name}
                    onDurationChange={syncPlayback}
                    onLoadedMetadata={syncPlayback}
                    onPause={syncPlayback}
                    onPlay={syncPlayback}
                    onRateChange={syncPlayback}
                    onTimeUpdate={syncPlayback}
                    onVolumeChange={syncPlayback}
                    onError={() => {
                        setMediaFailed(true);
                        setError('This video could not be played. Download the original to open it locally.');
                    }}
                />
                {error && <p className="asset-viewer-message" role="status">{error}</p>}
            </div>
            <div className="video-playback" role="group" aria-label="Video playback">
                <button
                    type="button"
                    className="native-icon video-play"
                    disabled={mediaFailed}
                    onClick={togglePlayback}
                    aria-label={paused ? 'Play video' : 'Pause video'}
                    title={paused ? 'Play video' : 'Pause video'}
                >
                    {paused ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}
                </button>
                <span className="video-time">{currentTime} <span>/</span> {totalTime}</span>
                <input
                    className="video-seek"
                    type="range"
                    aria-label="Seek video"
                    aria-valuetext={`${currentTime} of ${totalTime}`}
                    min={0}
                    max={duration || 1}
                    step="any"
                    value={duration ? Math.min(time, duration) : 0}
                    disabled={!duration || mediaFailed}
                    onChange={(event) => seekTo(event.currentTarget.valueAsNumber)}
                    onKeyDown={seekWithArrowKeys}
                />
                <button
                    type="button"
                    className="native-icon"
                    aria-label="Mute audio"
                    aria-pressed={muted}
                    title={muted ? 'Unmute' : 'Mute'}
                    disabled={mediaFailed}
                    onClick={() => {
                        video.current.muted = !video.current.muted;
                    }}
                >
                    {muted ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}
                </button>
                <span className="video-speed">
                    <select
                        aria-label="Playback speed"
                        title="Playback speed"
                        value={rate}
                        disabled={mediaFailed}
                        onChange={(event) => {
                            video.current.playbackRate = Number(event.currentTarget.value);
                        }}
                    >
                        {[0.5, 1, 1.25, 1.5, 2].map((speed) => (
                            <option key={speed} value={speed}>{speed}×</option>
                        ))}
                    </select>
                    <ChevronDown size={12} aria-hidden="true" />
                </span>
                <button
                    type="button"
                    className="native-icon"
                    aria-label="Loop video"
                    aria-pressed={loop}
                    title="Loop video"
                    disabled={mediaFailed}
                    onClick={() => setLoop((current) => !current)}
                >
                    <Repeat size={17} aria-hidden="true" />
                </button>
                {hasFullscreen && (
                    <button
                        type="button"
                        className="native-icon"
                        aria-label="Toggle fullscreen"
                        title="Toggle fullscreen"
                        disabled={mediaFailed}
                        onClick={toggleFullscreen}
                    >
                        <Maximize size={17} aria-hidden="true" />
                    </button>
                )}
            </div>
        </>
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

        sendServiceWorkerMessage(
            {
                type: 'CHECK_ASSET',
                url: asset.original_url,
            },
            { timeout: 10000 },
        )
            .then((result) => active && setStatus(result.cached ? 'saved' : 'available'))
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
            await sendServiceWorkerMessage(
                {
                    type: 'REMOVE_ASSET',
                    urls: [asset.preview_url, asset.viewer_url, asset.original_url],
                },
                { timeout: 30000 },
            );
            setStatus('available');
        } catch (error) {
            setStatus('saved');
            throw error;
        }
    }

    return { remove, save, status };
}

function DetailsPanel({ asset, folders, onClose, onDelete, onShare, onUpdate, online, canWrite, onView, viewing }) {
    const [name, setName] = useState(asset.name || '');
    const [annotation, setAnnotation] = useState(asset.annotation || '');
    const [url, setUrl] = useState(asset.url || '');
    const [tagInput, setTagInput] = useState('');
    const { remove: removeOfflineCopy, save: saveOfflineCopy, status: offlineStatus } = useOfflineAsset(asset);
    const [offlineError, setOfflineError] = useState(null);
    const [previewFailed, setPreviewFailed] = useState(false);
    const Preview = viewing ? 'div' : 'button';

    useEffect(() => {
        setName(asset.name || '');
        setAnnotation(asset.annotation || '');
        setUrl(asset.url || '');
        setTagInput('');
        setOfflineError(null);
        setPreviewFailed(false);
    }, [asset]);

    function addTag(event) {
        event.preventDefault();
        const tag = tagInput.trim();
        if (!canWrite || !tag || asset.tags.includes(tag)) {
            return;
        }
        onUpdate({ tags: [...asset.tags, tag] });
        setTagInput('');
    }

    function propertyDate(timestamp) {
        if (!timestamp) {
            return '—';
        }
        return new Intl.DateTimeFormat('sv-SE', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        })
            .format(new Date(Number(timestamp)))
            .replaceAll('-', '/');
    }

    return (
        <aside className="details-panel" aria-label="Asset inspector">
            <div className="details-header">
                <span className="sr-only">Asset details</span>
                <button className="native-icon" onClick={onClose} aria-label="Close details" title="Hide inspector">
                    <Pin size={16} />
                </button>
            </div>
            <div className="details-scroll">
                <Preview
                    className="details-preview"
                    type={viewing ? undefined : 'button'}
                    onClick={viewing ? undefined : (event) => onView(event.currentTarget)}
                    aria-label={viewing ? undefined : 'Open selected asset'}
                >
                    {previewFailed ? (
                        <div className="asset-fallback" aria-hidden="true">
                            {asset.media_type === 'video' ? <Film size={24} /> : <FileQuestion size={24} />}
                        </div>
                    ) : (
                        <img src={asset.preview_url} alt={viewing ? asset.name : ''} onError={() => setPreviewFailed(true)} />
                    )}
                    <span>{asset.extension}</span>
                </Preview>
                {!!asset.palettes.length && (
                    <div className="palette-row" aria-label="Image colors">
                        {asset.palettes.slice(0, 10).map((palette, index) => (
                            <span
                                key={index}
                                style={{ backgroundColor: `rgb(${palette.color.join(',')})` }}
                                title={`RGB ${palette.color.join(', ')} · ${palette.ratio}%`}
                            />
                        ))}
                    </div>
                )}
                <div className="details-section primary-fields">
                    <input
                        aria-label="Name"
                        readOnly={!canWrite}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        onBlur={() => canWrite && name !== asset.name && onUpdate({ name })}
                    />
                    <textarea
                        aria-label="Notes"
                        readOnly={!canWrite}
                        placeholder="Notes..."
                        rows={annotation ? Math.min(4, annotation.split('\n').length + 1) : 1}
                        value={annotation}
                        onChange={(event) => setAnnotation(event.target.value)}
                        onBlur={() => canWrite && annotation !== (asset.annotation || '') && onUpdate({ annotation })}
                    />
                    <div className="input-with-icon">
                        <input
                            aria-label="Source URL"
                            readOnly={!canWrite}
                            placeholder="URL..."
                            type="url"
                            value={url}
                            onChange={(event) => setUrl(event.target.value)}
                            onBlur={() => canWrite && url !== (asset.url || '') && onUpdate({ url })}
                        />
                        {asset.url && (
                            <a href={asset.url} target="_blank" rel="noreferrer" aria-label="Open source URL">
                                <LinkIcon size={16} />
                            </a>
                        )}
                    </div>
                </div>
                <div className="details-section">
                    <p className="details-label">Tags</p>
                    {!!asset.tags.length && (
                        <div className="tag-list">
                            {asset.tags.map((tag) => (
                                <button
                                    disabled={!canWrite}
                                    key={tag}
                                    onClick={() => onUpdate({ tags: asset.tags.filter((current) => current !== tag) })}
                                >
                                    {tag}
                                    {canWrite && <X size={11} />}
                                </button>
                            ))}
                        </div>
                    )}
                    <form className="tag-input" onSubmit={addTag}>
                        <Plus size={16} />
                        <input
                            aria-label="New tag"
                            disabled={!canWrite}
                            placeholder="New tag"
                            value={tagInput}
                            onChange={(event) => setTagInput(event.target.value)}
                        />
                    </form>
                </div>
                <div className="details-section">
                    <p className="details-label">Folders</p>
                    {!!asset.folder_ids.length && (
                        <div className="assigned-folders">
                            {folders
                                .filter((folder) => asset.folder_ids.includes(folder.id))
                                .map((folder) => (
                                    <span key={folder.id}>
                                        <Folder size={13} />
                                        {folder.name}
                                    </span>
                                ))}
                        </div>
                    )}
                    <details className="folder-chooser">
                        <summary>
                            <Plus size={16} />
                            {canWrite ? 'Add Category' : 'View categories'}
                        </summary>
                        <div className="folder-checks">
                            {folders.map((folder) => (
                                <label key={folder.id}>
                                    <input
                                        checked={asset.folder_ids.includes(folder.id)}
                                        disabled={!canWrite}
                                        type="checkbox"
                                        onChange={(event) =>
                                            onUpdate({
                                                folder_ids: event.target.checked
                                                    ? [...asset.folder_ids, folder.id]
                                                    : asset.folder_ids.filter((id) => id !== folder.id),
                                            })
                                        }
                                    />
                                    <Folder size={14} />
                                    {folder.name}
                                </label>
                            ))}
                        </div>
                    </details>
                </div>
                <div className="details-section property-list">
                    <p className="details-label">Properties</p>
                    <dl>
                        <div>
                            <dt>Rating</dt>
                            <dd className="rating-row">
                                {[1, 2, 3, 4, 5].map((rating) => (
                                    <button
                                        aria-label={`Rate ${rating} stars`}
                                        disabled={!canWrite}
                                        key={rating}
                                        onClick={() => onUpdate({ rating: asset.rating === rating ? 0 : rating })}
                                    >
                                        <Star
                                            fill="currentColor"
                                            size={16}
                                            className={rating <= asset.rating ? 'rated' : ''}
                                        />
                                    </button>
                                ))}
                            </dd>
                        </div>
                        <div>
                            <dt>Dimensions</dt>
                            <dd>{asset.width && asset.height ? `${asset.width} × ${asset.height}` : '—'}</dd>
                        </div>
                        <div>
                            <dt>Size</dt>
                            <dd>{formatBytes(asset.size)}</dd>
                        </div>
                        <div>
                            <dt>Type</dt>
                            <dd>{asset.extension}</dd>
                        </div>
                        {asset.duration && (
                            <div>
                                <dt>Duration</dt>
                                <dd>{formatDuration(asset.duration)}</dd>
                            </div>
                        )}
                        <div>
                            <dt>Date Imported</dt>
                            <dd>{propertyDate(asset.birth_time)}</dd>
                        </div>
                        <div>
                            <dt>Date Created</dt>
                            <dd>{propertyDate(asset.birth_time)}</dd>
                        </div>
                        <div>
                            <dt>Date Modified</dt>
                            <dd>{propertyDate(asset.modification_time)}</dd>
                        </div>
                    </dl>
                </div>
                <div className="details-actions">
                    <a className="download-button" href={asset.download_url}>
                        <Upload size={17} />
                        Export
                    </a>
                    {!asset.is_deleted && (
                        <button type="button" disabled={!online} onClick={onShare}>
                            <LinkIcon size={16} aria-hidden="true" /> Share link
                        </button>
                    )}
                    {offlineStatus !== 'unsupported' && (
                        <button
                            className={`offline-button ${offlineStatus === 'saved' ? 'saved' : ''}`}
                            disabled={
                                offlineStatus === 'checking' ||
                                offlineStatus === 'saving' ||
                                (!online && offlineStatus !== 'saved')
                            }
                            onClick={async () => {
                                setOfflineError(null);
                                try {
                                    offlineStatus === 'saved' ? await removeOfflineCopy() : await saveOfflineCopy();
                                } catch (error) {
                                    setOfflineError(error.message);
                                }
                            }}
                        >
                            {offlineStatus === 'saving' ? (
                                <LoaderCircle className="spin" size={14} />
                            ) : offlineStatus === 'saved' ? (
                                <CloudCheck size={14} />
                            ) : (
                                <CloudDownload size={14} />
                            )}
                            {
                                {
                                    checking: 'Checking offline copy…',
                                    saving: 'Saving offline…',
                                    saved: 'Saved offline · Remove',
                                    available: 'Save offline',
                                }[offlineStatus]
                            }
                        </button>
                    )}
                    {offlineError && <p className="offline-error">{offlineError}</p>}
                    {canWrite &&
                        (asset.is_deleted ? (
                            <button className="restore-button" onClick={() => onUpdate({ is_deleted: false })}>
                                <ArchiveRestore size={14} />
                                Restore
                            </button>
                        ) : (
                            <button className="trash-button" onClick={onDelete}>
                                <Trash2 size={14} />
                                Move to trash
                            </button>
                        ))}
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

    const loadDirectory = useCallback(async (path) => {
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
            onMouseDown={(event) => event.target === event.currentTarget && onClose()}
        >
            <section className="storage-browser">
                <header className="storage-browser-header">
                    <div>
                        <p>WebDAV setup</p>
                        <h2>Choose the library folder</h2>
                    </div>
                    <button onClick={onClose} aria-label="Close OpenCloud browser">
                        <X size={20} />
                    </button>
                </header>

                <div className="storage-browser-status">
                    <span>Configured root</span>
                    <code>{directory?.configured_root || 'Loading…'}</code>
                </div>

                <div className="storage-browser-path">
                    <button
                        disabled={loading || !directory?.parent}
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

                    {!loading && error && (
                        <div className="storage-browser-message error">
                            <FileQuestion size={25} />
                            <p>{error}</p>
                            <button onClick={() => loadDirectory(directory?.path || '/')}>Try again</button>
                        </div>
                    )}

                    {!loading && !error && !directory?.directories.length && (
                        <div className="storage-browser-message">
                            <Folder size={25} />
                            <p>This folder has no subfolders.</p>
                        </div>
                    )}

                    {!loading &&
                        !error &&
                        directory?.directories.map((item) =>
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
                            ),
                        )}
                </div>

                <footer className="storage-browser-footer">
                    <div>
                        {directory?.library_count > 0 ? (
                            <p>
                                Found {directory.library_count}{' '}
                                {directory.library_count === 1 ? 'library' : 'libraries'} directly in this folder.
                            </p>
                        ) : (
                            <p>Open folders until the `.library` directories are shown here.</p>
                        )}
                        {copied && <span>Copied. Update your library connection settings to use this folder.</span>}
                    </div>
                    <button disabled={!directory?.library_count || loading} onClick={copyRoot}>
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
            <div className="brand-mark">
                <span></span>
                <span></span>
                <span></span>
            </div>
            <p className="eyebrow">Indexframe</p>
            <h1>No libraries indexed yet.</h1>
            <p>
                Browse the configured OpenCloud Space to find the folder that directly contains your{' '}
                <code>.library</code> directories, then update the WebDAV root and run a sync.
            </p>
            <div className="empty-library-actions">
                <button disabled={!online} onClick={() => setBrowserOpen(true)}>
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
