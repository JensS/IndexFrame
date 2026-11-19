# netcup Webhosting 4000 NUE

This deployment runs the viewer on Apache/PHP 8.5 with MySQL 8.4. OpenCloud remains the source of truth and the only library storage backend. No Docker, Node, Redis, Supervisor, storage symlink, or persistent worker is needed on netcup.

## Local hosting simulation

Docker is used only on the development machine. The simulation has Apache/PHP 8.5 at `/webspace/project`, a separate PHP 8.4 command container at `/project`, MySQL 8.4 with a latin1 server default, and a read-only WebDAV fixture with Unicode filenames/tags. Web and CLI share storage under different absolute paths. The PHP limits are 512 MB memory, 180 seconds execution, and 128 MB upload/POST; `open_basedir` is restricted to each simulated webspace. FFmpeg and FFprobe are deliberately absent. This approximates hosting constraints; it does not reproduce netcup's process manager or guarantee a cron runtime.

Create local simulation secrets (this does not read or change your regular `.env`):

```sh
cp .env.netcup.local.example .env.netcup.local
php -r 'file_put_contents(".env.netcup.local", "NETCUP_LOCAL_APP_KEY=".chr(39)."base64:".base64_encode(random_bytes(32)).chr(39)."\nNETCUP_LOCAL_PASSWORD_HASH=".chr(39).password_hash("netcup-local-test", PASSWORD_BCRYPT).chr(39)."\n");'
docker compose --env-file .env.netcup.local -f compose.netcup.yaml build web cli tests webdav
docker compose --env-file .env.netcup.local -f compose.netcup.yaml up -d --wait mysql webdav web
docker compose --env-file .env.netcup.local -f compose.netcup.yaml run --rm cli artisan migrate --force
docker compose --env-file .env.netcup.local -f compose.netcup.yaml run --rm cli artisan eagle:sync --queued --prune
docker compose --env-file .env.netcup.local -f compose.netcup.yaml run --rm cli artisan schedule:run
```

Open <http://localhost:8085> and sign in with `netcup-local-test`. The local HTTP cookie setting is intentionally different from production, which requires HTTPS. Run `schedule:run` again to simulate another minute of cron. It exits after the scheduled work; no scheduler daemon is installed.

Run the full test suite against the separate `indexframe_testing` MySQL database:

```sh
docker compose --env-file .env.netcup.local -f compose.netcup.yaml run --rm tests
docker compose --env-file .env.netcup.local -f compose.netcup.yaml run --rm tests php tests/netcup-smoke.php
```

The test database is created only in this local simulation and is not required on netcup. To exercise your existing OpenCloud instead of the fixture, set the `NETCUP_LOCAL_WEBDAV_*` values in `.env.netcup.local`, then recreate `web`. The default simulation is read-only. Quote password hashes and other values containing `$` with single quotes to prevent Compose variable interpolation.

Stop with `docker compose --env-file .env.netcup.local -f compose.netcup.yaml down`. Volumes persist. `down --volumes` permanently removes the simulation's database and private storage.

## Build the upload archive locally

```sh
./bin/build-netcup
```

This builds frontend assets with Node and production PHP dependencies with PHP 8.4, then creates `dist/indexframe-netcup.tar.gz`. It includes `vendor/` and `public/build/`, so Node and Composer are unnecessary on hosting. The archive excludes `.env` secrets, existing storage, SQLite files, compiled configuration, development dependencies, tests, and public storage links. It contains empty writable storage directories and `.env.netcup.example`.

## Prepare netcup

1. Create **one** MySQL database and its user in the hosting panel. Use the database hostname shown there, not an assumed `localhost`. Set the database character set/collation explicitly (the account quota is 25 databases):

   ```sql
   ALTER DATABASE `your-netcup-database` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

   Laravel also sets `utf8mb4` / `utf8mb4_unicode_ci` on its connection and creates its tables with those settings. The library path uses an indexable VARCHAR because MySQL cannot create the old unique TEXT index. This change applies when creating the new MySQL index; an existing SQLite index can remain on Hetzner for rollback.

2. Put the extracted application in `/project/` in the SSH chroot. Set the domain's document root to **`project/public`**, PHP to **8.5**, and the broader **`{WEBSPACEROOT}`** `open_basedir` preset. Enable Let's Encrypt and HTTPS.

3. Copy `.env.netcup.example` to `.env` on hosting. Fill in the real domain, database credentials, archive password hash, application key, and existing OpenCloud URL/user/App Token/root. Keep the WebDAV App Token server-side. Use the same `APP_KEY` if retaining encrypted data from the old deployment. Generate a new key only for a new installation. Preserve your archive password hash. In a `.env` file, single-quote hashes containing `$`.

4. Keep absolute path overrides unset: `VIEW_COMPILED_PATH`, `EAGLE_WRITE_BACKUPS_PATH`, `EAGLE_DERIVATIVE_PATH`, `EAGLE_DERIVATIVE_TEMPORARY_PATH`, and `EAGLE_WEBDAV_PASSWORD_FILE`. The web runtime and SSH chroot see different absolute paths. Runtime defaults calculate paths independently. A token can be supplied directly in `.env`; if using a password file, use a project-relative path accessible in both contexts.

5. Ensure `storage/` and `bootstrap/cache/` are writable by the hosting account. Keep `.env` private. Do not expose the project root as the document root. Start with `EAGLE_WRITES_ENABLED=false`.

All server-side PHP commands must use the wrapper:

```sh
cd /project
chmod +x bin/netcup-artisan bin/netcup-cron
./bin/netcup-artisan config:clear
./bin/netcup-artisan route:clear
./bin/netcup-artisan view:clear
./bin/netcup-artisan migrate --force
./bin/netcup-artisan eagle:status
./bin/netcup-artisan eagle:sync --queued --prune
./bin/netcup-artisan schedule:run
```

The wrapper always invokes **`PHPRC=/mybin/php-ini /usr/local/php84/bin/php`**. Bare `php` on hosting is 7.4 and cannot run this application. Keep `PHPRC` exported if manually invoking subprocesses. If Composer is ever needed remotely, run its PHP script through the same PHP 8.4 binary and configuration; do not rely on a script's bare-php shebang.

Do **not** run `config:cache`, `optimize`, or `storage:link`. Leave views to compile during web requests. Files are already served by authenticated Laravel controllers, including private generated images and WebDAV streams.

## Cron and resumable indexing

Create a hosting-panel task that runs every minute:

```sh
cd /project && /bin/sh bin/netcup-cron >> storage/logs/cron.log 2>&1
```

If the panel expects only a command rather than a crontab line, enter that command and choose the every-minute schedule in the panel. Its equivalent full crontab entry is:

```cron
* * * * * cd /project && /bin/sh bin/netcup-cron >> storage/logs/cron.log 2>&1
```

`schedule:run` queues discovery every ten minutes and drains the database queue every minute with:

```text
queue:work database --stop-when-empty --max-time=45 --max-jobs=50 --tries=3 --timeout=120 --memory=384
```

Database locks prevent overlapping drains. Each library is indexed in batches of five changed items by default. A durable database checkpoint advances after each successful batch, and its next queue job is committed with the checkpoint. A stopped worker resumes from the checkpoint on a later invocation. Unchanged items are skipped when `mtime.json` is available. A missing manifest still progresses through every batch. Pruning waits until the library's entire scan succeeds and deletes only records identified as missing at the start of that scan.

`--max-time` and `--memory` are checked between jobs, so they are not a hard wall-clock or memory limit. Job timeout enforcement depends on PCNTL, which shared hosting may not provide. HTTP calls have timeouts and jobs do limited work, but the host can still terminate a slow job. The queue's `retry_after` is 240 seconds, above its 120-second timeout and 180-second sync-lock expiry. A killed task can therefore take several minutes to become eligible again. The tested 20-minute hosting cron runtime is not treated as a guarantee.

Check failed jobs and retained checkpoints when a library stays partially indexed:

```sh
./bin/netcup-artisan queue:failed
./bin/netcup-artisan queue:retry all
./bin/netcup-artisan eagle:sync --queued --prune
```

Fix unreadable/invalid source metadata before retrying. Failed batches do not advance their checkpoint. For shared hosting, use `--queued`; the original synchronous command remains available for controlled maintenance runs on a development machine. Rotate `storage/logs/cron.log` and `laravel.log` according to your hosting retention needs.

## Media and uploads

The web upload limit is **120 MiB per file and per request**, leaving room for multipart overhead below netcup's 128 MB POST cap. Both the browser and Laravel validate this. Large files should continue to enter the library through the OpenCloud client/WebDAV and be picked up by indexing. There is no direct-to-S3 upload flow in this application; adding one would require staging/import into the existing OpenCloud library, not just changing a filesystem setting.

GD generates common image renditions when FFmpeg is unavailable. Image decoding checks the pixel cap and estimated available PHP memory before allocating images. Formats that GD cannot decode need an existing Eagle thumbnail; video uploads cannot create new posters without FFmpeg. Leave `EAGLE_FFMPEG_PATH` and `EAGLE_FFPROBE_PATH` empty unless those binaries have been verified on hosting.

## Cutover and rollback

Before cutover, retain the old Hetzner deployment, its environment, database, private metadata backups, and generated files. Do not copy its cached configuration. The MySQL search index can be rebuilt from OpenCloud, so no SQLite-to-MySQL conversion is needed. Copy any existing `storage/app/private/eagle-write-backups/` into the new deployment if you need the edit-history backups; generated renditions can be regenerated.

Verify `/up`, login/logout, library/asset counts, Unicode search, folders/tags, private previews, original downloads, video ranges, and at least two real hosting cron invocations on a staging domain. Leave writes disabled while comparing both deployments. Change DNS only after those checks pass. Stop the old scheduler after cutover. Retain the old viewer for rollback until the new host has been exercised with the real library size and traffic. No live deployment or DNS change is performed by the local simulation/build commands.

Laravel's [queue documentation](https://laravel.com/framework/docs/13.x/queues) describes finite worker runs and timeout/retry ordering; its [scheduling documentation](https://laravel.com/framework/docs/scheduling) covers the every-minute scheduler and overlap locks. Hosting-specific limits in this document come from the supplied netcup testflight.
