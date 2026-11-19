<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>{{ $asset->name }} · {{ config('app.name') }}</title>
        <link rel="icon" href="/icons/indexframe.svg" type="image/svg+xml">
        @vite('resources/css/app.css')
    </head>
    <body class="shared-asset-page">
        <main class="shared-asset">
            <header class="shared-asset-header">
                <h1>{{ $asset->name }}</h1>
                <a href="{{ route('assetShares.download', $asset->share_token, false) }}">Download original</a>
            </header>

            <div class="shared-asset-media">
                @if($asset->sharePreviewType() === 'image')
                    <img src="{{ route('assetShares.preview', $asset->share_token, false) }}" alt="{{ $asset->name }}">
                @elseif($asset->sharePreviewType() === 'video')
                    <video
                        src="{{ route('assetShares.preview', $asset->share_token, false) }}"
                        width="{{ $asset->width ?: 640 }}"
                        height="{{ $asset->height ?: 360 }}"
                        controls
                        playsinline
                        preload="metadata"
                    ></video>
                @else
                    <p>Download {{ $asset->file_name }} to view it.</p>
                @endif
            </div>
        </main>
    </body>
</html>
