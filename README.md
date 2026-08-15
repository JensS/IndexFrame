# Indexframe

Indexframe is a private, self-hosted web interface for browsing visual asset libraries stored in OpenCloud. It indexes Eagle-compatible `.library` directories over WebDAV and presents them as a fast, searchable, installable web app.

OpenCloud is currently the only supported storage backend. Indexframe expects an existing OpenCloud instance and does not manage or replace it.

The project is independent and community maintained. It is not affiliated with, endorsed by, or sponsored by Eagle or OpenCloud, and it does not bundle their code, logos, or user content.

> [!IMPORTANT]
> Indexframe is early-stage software that reads and can optionally modify a third-party file format. Keep verified backups and begin with writes disabled.

## What it does

- Discovers and switches between multiple `.library` directories
- Searches names, notes, URLs, extensions, tags, folders, and smart folders
- Displays protected image and video previews without exposing WebDAV credentials
- Generates private 640, 960, and 1600 pixel WebP renditions on the server
- Provides hover previews, a full asset viewer, clipboard copying, downloads, and video-frame capture
- Accepts browser uploads and drag-and-drop imports
- Edits names, notes, ratings, tags, folder assignments, and trash state
- Installs as a progressive web app
- Caches a complete library index and optimized previews for offline browsing
- Pins selected originals and playable videos for offline access
- Ships with password authentication, CSRF protection, rate limiting, and hardened production headers
- Includes a Docker image and Dokploy-compatible Compose deployment

## How it works

```text
Browser  --HTTPS-->  Indexframe  --WebDAV-->  OpenCloud  -->  *.library
                         |
                         +--> SQLite search index
                         +--> generated WebP renditions
                         +--> sessions, locks, and metadata backups
```

OpenCloud is the source of truth. The SQLite database is a rebuildable search index; original assets are streamed from WebDAV and never copied into the application volume. Generated renditions and pre-write metadata backups live only in Indexframe's persistent storage.

## Requirements

- An existing OpenCloud instance containing one or more `.library` directories
- An OpenCloud user and dedicated App Token with access to those libraries
- Docker with Compose, or a Dokploy Compose deployment
- An HTTPS domain in production and for service-worker/offline features

For source development, PHP 8.3+, Composer 2, Node.js 22+, FFmpeg, FFprobe, GD, PDO, cURL, and SQLite are also required.

## Prepare OpenCloud

Copy the exact WebDAV URL from the OpenCloud Space information panel. A Space URL normally resembles:

```text
https://cloud.example.com/remote.php/dav/spaces/your-space-id/
```

Create a dedicated App Token instead of using the account password. The configured OpenCloud user must be able to read the Space and must have write access if Indexframe writes will be enabled.

Indexframe scans only the immediate children of `OPENCLOUD_WEBDAV_ROOT`. It detects directories that end in `.library` and contain both `metadata.json` and an `images` directory. Use `/` when the libraries are direct children of the Space; use a relative path such as `/Eagle Libraries` when they are inside a subfolder.

If no libraries are indexed, choose **Browse OpenCloud** on the empty screen. The authenticated, read-only folder browser starts at the Space root, marks valid libraries, and copies the exact `OPENCLOUD_WEBDAV_ROOT` value for Dokploy. WebDAV credentials remain server-side and browser responses are never stored in the offline cache.

## Environment configuration

These are all environment values accepted by the included [`compose.yaml`](compose.yaml). Copy [`deploy.env.example`](deploy.env.example) to an ignored file such as `.env.deploy`, replace the required placeholders, and keep the file out of version control.

```dotenv
# Required application settings
APP_URL=https://indexframe.example.com
APP_KEY=base64:replace-with-a-generated-key
EAGLE_PASSWORD_HASH=replace-with-a-generated-password-hash

# Required OpenCloud connection
OPENCLOUD_WEBDAV_URL=https://cloud.example.com/remote.php/dav/spaces/your-space-id/
OPENCLOUD_WEBDAV_USERNAME=your-opencloud-user
OPENCLOUD_WEBDAV_TOKEN=your-dedicated-app-token

# OpenCloud library location and TLS
OPENCLOUD_WEBDAV_ROOT=/
OPENCLOUD_WEBDAV_VERIFY_TLS=true

# Library writes and safety
EAGLE_WRITES_ENABLED=false
EAGLE_WRITE_BACKUPS_ENABLED=true
EAGLE_WRITE_BACKUPS_KEEP_PER_ASSET=25
EAGLE_UPLOAD_MAX_KILOBYTES=512000

# Generated image renditions
EAGLE_DERIVATIVE_WEBP_QUALITY=78
EAGLE_DERIVATIVE_TIMEOUT=90
EAGLE_DERIVATIVE_GD_MAXIMUM_PIXELS=80000000

# Background services
EAGLE_SYNC_ON_START=true
EAGLE_SCHEDULER_ENABLED=true

# Container and logging
INDEXFRAME_IMAGE_TAG=latest
LOG_LEVEL=warning
```

The first six values are deployment-specific and must be replaced. Set `OPENCLOUD_WEBDAV_ROOT` to the folder that directly contains the libraries; the remaining values show the production defaults and may usually be kept as written.

Generate `APP_KEY` with:

```bash
php -r "echo 'base64:'.base64_encode(random_bytes(32)).PHP_EOL;"
```

Generate `EAGLE_PASSWORD_HASH` with `php artisan eagle:password` from a source checkout. Store the App Token and password hash as secrets in Dokploy; do not commit them or paste them into issue reports.

The Compose deployment passes `OPENCLOUD_WEBDAV_TOKEN` to the application as a read-only Docker secret. Production startup refuses to run with OpenCloud TLS verification disabled.

## Deploy

With Docker Compose:

```bash
cp deploy.env.example .env.deploy
# Edit .env.deploy before continuing.
docker compose --env-file .env.deploy up -d --build
docker compose --env-file .env.deploy exec app php artisan eagle:status
docker compose --env-file .env.deploy exec app php artisan eagle:audit
docker compose --env-file .env.deploy exec app php artisan eagle:sync --prune
```

For Dokploy:

1. Create a Compose deployment from `compose.yaml`.
2. Add every value from the environment block above to the deployment environment.
3. Expose internal port `80` through an HTTPS domain.
4. Preserve the `indexframe_storage` volume across redeployments.
5. Deploy first with `EAGLE_WRITES_ENABLED=false`.
6. Run `php artisan eagle:status` and `php artisan eagle:audit` in the app container.
7. Enable writes only after a complete audit and source-library backup.

The container migrates its database on startup and runs an overlap-protected library sync every ten minutes by default. `/up` is the health-check endpoint.

## Library write safety

Eagle does not expose a shared transaction or locking protocol for third-party writers. Indexframe therefore cannot promise conflict-free concurrent editing with the desktop application.

The write path is deliberately conservative:

- Writes are disabled unless `EAGLE_WRITES_ENABLED=true` is explicitly configured.
- Existing item metadata is read with its WebDAV ETag and written with `If-Match`.
- Unknown metadata fields are preserved.
- Uploads are assembled in a staging directory and published with one non-overwriting WebDAV `MOVE`.
- `mtime.json` updates use ETag retries and never replace a newer timestamp with an older one.
- Existing metadata is backed up before every edit.
- `eagle:audit` performs read-only structural checks.

Avoid editing the same asset in Indexframe and the desktop application simultaneously. Keep complete OpenCloud or VPS snapshots; metadata backups are not a replacement for asset backups.

See [the unofficial interoperability notes](docs/library-format.md) for the observed `.library` structure.

## Offline mode

Use **Save offline** in the sidebar to cache the searchable metadata index and one optimized preview or video poster per asset. Downloads are resumable and report browser quota failures. Offline browsing supports search, folders, tags, smart folders, and filtering.

Whole-library caching does not include original files or playable videos. Pin those individually from the asset details panel. **Lock archive** clears private Indexframe caches from the current browser profile.

Browsers may evict site data despite the app requesting persistent storage. Offline copies should not be treated as backups.

## Useful commands

Run these inside the application container, or directly in a configured source checkout:

```bash
php artisan eagle:password
php artisan eagle:status
php artisan eagle:sync --prune
php artisan eagle:audit
php artisan eagle:audit --limit=100
php artisan test
npm run build
```

## Current limitations

- OpenCloud WebDAV is the only supported storage backend.
- Authentication uses one shared archive password; there are no per-user accounts or permissions.
- Offline mode is read-only.
- Library-format compatibility is based on observed files and may require updates after desktop-app releases.
- Writes cannot coordinate with a desktop client that is editing the same asset concurrently.

## Development

Install the source dependencies and create a local application environment:

```bash
composer install
npm install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite
php artisan migrate
```

Configure the existing OpenCloud connection in `.env`, then run:

```bash
php artisan eagle:status
php artisan eagle:sync --prune
composer dev
```

Run the complete verification suite before submitting changes:

```bash
./vendor/bin/pint --test
php artisan test
npm run build
docker compose --env-file deploy.env.example config --quiet
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License and trademarks

Indexframe is available under the [MIT License](LICENSE).

Eagle is a trademark of its respective owner. OpenCloud and other product names belong to their respective owners. Their names are used only to describe interoperability. Indexframe is an independent project and is not affiliated with or endorsed by those projects or companies.
