# Changelog

All notable changes to Indexframe will be documented in this file.

The project follows [Semantic Versioning](https://semver.org/) after the first tagged release.

## Unreleased

### Added

- Password-protected browsing and management of multiple WebDAV-backed visual libraries
- Search, folders, smart folders, tags, ratings, uploads, metadata editing, and trash support
- Private server-generated WebP renditions and protected original-file streaming
- Installable PWA with resumable whole-library offline metadata and preview caching
- Production Docker image, Dokploy Compose deployment, scheduler, health check, and write-safety tooling

### Security

- Read-only-by-default library access
- CSRF protection, login rate limiting, encrypted production sessions, restrictive response headers, and TLS enforcement
- ETag-based conflict detection, non-overwriting publication, and pre-write metadata backups
