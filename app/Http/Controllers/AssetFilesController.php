<?php

namespace App\Http\Controllers;

use App\Models\EagleAsset;
use App\Models\EagleLibrary;
use App\Services\EagleAssetLocator;
use App\Services\EagleImageDerivative;
use App\Services\EagleStorage;
use DateTimeImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\HeaderUtils;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AssetFilesController extends Controller
{
    public function __construct(private EagleStorage $storage) {}

    public function preview(
        EagleLibrary $library,
        EagleAsset $asset,
        EagleAssetLocator $locator,
        Request $request,
    ): StreamedResponse {
        $this->ensureAssetBelongsToLibrary($asset, $library);
        $path = $locator->preview($asset);
        $mimeType = $asset->thumbnail_file_name ? 'image/png' : $asset->mime_type;

        return $this->stream($path, $mimeType, 'private, max-age=86400', $request, $asset->extension === 'svg');
    }

    public function image(
        EagleLibrary $library,
        EagleAsset $asset,
        int $width,
        EagleImageDerivative $derivative,
        Request $request,
    ): BinaryFileResponse {
        $this->ensureAssetBelongsToLibrary($asset, $library);
        abort_unless(in_array($width, config('eagle.derivatives.widths'), true), 404);
        $path = $derivative->make($asset, $width);
        $response = response()->file($path, [
            'Content-Type' => 'image/webp',
        ]);
        $response->setPrivate();
        $response->setMaxAge(31536000);
        $response->headers->addCacheControlDirective('immutable');
        $response->setEtag(hash_file('sha256', $path));
        $response->setLastModified(new DateTimeImmutable('@'.File::lastModified($path)));
        $response->isNotModified($request);

        return $response;
    }

    public function original(
        EagleLibrary $library,
        EagleAsset $asset,
        EagleAssetLocator $locator,
        Request $request,
    ): StreamedResponse {
        $this->ensureAssetBelongsToLibrary($asset, $library);

        return $this->stream(
            $locator->original($asset),
            $asset->mime_type,
            'private, max-age=3600',
            $request,
            $asset->extension === 'svg',
        );
    }

    public function download(
        EagleLibrary $library,
        EagleAsset $asset,
        EagleAssetLocator $locator,
        Request $request,
    ): StreamedResponse {
        $this->ensureAssetBelongsToLibrary($asset, $library);

        return $this->stream(
            $locator->original($asset),
            $asset->mime_type,
            'private, no-store',
            $request,
            downloadName: $asset->file_name,
        );
    }

    private function stream(
        string $path,
        string $mimeType,
        string $cacheControl,
        Request $request,
        bool $sandboxSvg = false,
        ?string $downloadName = null,
    ): StreamedResponse {
        $range = $request->header('Range');
        $range = is_string($range) && preg_match('/^bytes=(?:\d+-\d*|-\d+)$/', $range) === 1 ? $range : null;
        $remote = $this->storage->remoteStream($path, $range);
        $headers = [
            'Accept-Ranges' => 'bytes',
            'Cache-Control' => $cacheControl,
            'Content-Type' => $mimeType,
        ];

        if ($remote['content_length']) {
            $headers['Content-Length'] = $remote['content_length'];
        }

        if ($remote['content_range']) {
            $headers['Content-Range'] = $remote['content_range'];
        }

        if ($sandboxSvg) {
            $headers['Content-Security-Policy'] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
        }

        if ($downloadName) {
            $fallbackName = preg_replace('/[^\x20-\x7E]/', '_', $downloadName) ?: 'download';
            $headers['Content-Disposition'] = HeaderUtils::makeDisposition('attachment', $downloadName, $fallbackName);
        }

        return new StreamedResponse(function () use ($remote): void {
            try {
                fpassthru($remote['body']);
            } finally {
                fclose($remote['body']);
            }
        }, $remote['status'], $headers);
    }

    private function ensureAssetBelongsToLibrary(EagleAsset $asset, EagleLibrary $library): void
    {
        abort_unless($asset->eagle_library_id === $library->id, 404);
    }
}
