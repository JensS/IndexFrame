# Contributing to Indexframe

Thanks for helping improve Indexframe.

## Before opening an issue

- Search existing issues first.
- Remove personal assets, filenames, URLs, credentials, tokens, and library metadata from screenshots and logs.
- Use synthetic fixtures when demonstrating a library-format problem.
- Report security issues privately as described in [SECURITY.md](SECURITY.md).

## Local development

```bash
composer install
npm install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite
php artisan migrate
```

The test suite uses generated fixtures and does not need a real OpenCloud account:

```bash
./vendor/bin/pint --test
php artisan test
npm run build
docker compose --env-file deploy.env.example config --quiet
```

## Pull requests

- Keep changes focused and explain the user-visible outcome.
- Add or update tests for behavior changes.
- Preserve unknown library metadata fields.
- Do not add real `.library` directories, media, credentials, database files, or generated build output.
- Treat write-path changes as high risk and document their concurrency behavior.
- Use present-tense commit messages such as `Add offline cache status` or `Fix WebDAV root discovery`.

By contributing, you agree that your work is licensed under the repository's MIT License.
