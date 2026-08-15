<?php

namespace App\Services;

use App\Exceptions\EagleWriteConflictException;
use League\Flysystem\DirectoryAttributes;
use League\Flysystem\FileAttributes;
use League\Flysystem\FilesystemOperator;
use League\Flysystem\StorageAttributes;
use RuntimeException;
use Sabre\DAV\Client;
use Sabre\HTTP\Request;
use Throwable;

class EagleStorage
{
    public function __construct(
        private FilesystemOperator $filesystem,
        private ?Client $webDavClient = null,
        private string $webDavRoot = '',
    ) {}

    public function fileExists(string $path): bool
    {
        return $this->filesystem->fileExists($path);
    }

    public function directoryExists(string $path): bool
    {
        return $this->filesystem->directoryExists($path);
    }

    public function createDirectory(string $path): void
    {
        $this->filesystem->createDirectory($path);
    }

    public function deleteDirectory(string $path): void
    {
        $this->filesystem->deleteDirectory($path);
    }

    public function delete(string $path): void
    {
        $this->filesystem->delete($path);
    }

    public function ensureRootExists(): void
    {
        if ($this->directoryExists('')) {
            return;
        }

        if (! $this->webDavClient) {
            $this->createDirectory('');

            return;
        }

        $status = $this->webDavClient->request('MKCOL', $this->remoteUrl(''))['statusCode'];

        if (! in_array($status, [201, 405], true)) {
            throw new RuntimeException("OpenCloud returned {$status} while creating the library root.");
        }
    }

    public function move(string $source, string $destination): void
    {
        $this->filesystem->move($source, $destination);
    }

    public function moveSafely(string $source, string $destination): void
    {
        if (! $this->webDavClient) {
            if ($this->fileExists($destination) || $this->directoryExists($destination)) {
                throw new EagleWriteConflictException;
            }

            $this->move($source, $destination);

            return;
        }

        $response = $this->webDavClient->request('MOVE', $this->remoteUrl($source), null, [
            'Destination' => $this->remoteUrl($destination),
            'Overwrite' => 'F',
        ]);

        if (in_array($response['statusCode'], [409, 412], true)) {
            throw new EagleWriteConflictException;
        }

        if ($response['statusCode'] < 200 || $response['statusCode'] >= 300) {
            throw new RuntimeException(
                "OpenCloud returned {$response['statusCode']} while publishing {$destination}.",
            );
        }
    }

    public function read(string $path): string
    {
        return $this->filesystem->read($path);
    }

    /** @return resource */
    public function readStream(string $path)
    {
        $stream = $this->filesystem->readStream($path);

        if (! is_resource($stream)) {
            throw new RuntimeException("Unable to stream {$path} from OpenCloud.");
        }

        return $stream;
    }

    /** @param resource $stream */
    public function writeStream(string $path, $stream): void
    {
        $this->filesystem->writeStream($path, $stream);
    }

    public function write(string $path, string $contents): void
    {
        $this->filesystem->write($path, $contents);
    }

    public function fileSize(string $path): int
    {
        return $this->filesystem->fileSize($path);
    }

    /** @return array<int, DirectoryAttributes|FileAttributes> */
    public function list(string $path, bool $deep = false): array
    {
        $entries = iterator_to_array($this->filesystem->listContents($path, false), false);

        if ($this->webDavClient && $this->webDavRoot !== '') {
            $entries = array_map(
                fn (StorageAttributes $entry): StorageAttributes => $this->logicalAttribute($entry),
                $entries,
            );
        }

        if (! $deep) {
            return $entries;
        }

        $contents = $entries;

        foreach ($entries as $entry) {
            if ($entry->isDir()) {
                array_push($contents, ...$this->list($entry->path(), true));
            }
        }

        return $contents;
    }

    /** @return array<string, mixed> */
    public function readJson(string $path): array
    {
        return json_decode($this->read($path), true, flags: JSON_THROW_ON_ERROR);
    }

    public function readJsonDocument(string $path): EagleJsonDocument
    {
        if (! $this->webDavClient) {
            $contents = $this->read($path);

            return new EagleJsonDocument(
                json_decode($contents, true, flags: JSON_THROW_ON_ERROR),
                hash('sha256', $contents),
            );
        }

        $response = $this->webDavClient->request('GET', $this->remoteUrl($path));

        if ($response['statusCode'] !== 200) {
            throw new RuntimeException("OpenCloud returned {$response['statusCode']} while reading {$path}.");
        }

        $version = $this->headerValue($response['headers'], 'etag');

        if ($version === null || $version === '') {
            throw new RuntimeException("OpenCloud did not provide an ETag for {$path}; safe writes are unavailable.");
        }

        return new EagleJsonDocument(
            json_decode($response['body'], true, flags: JSON_THROW_ON_ERROR),
            $version,
        );
    }

    /** @param array<string, mixed> $data */
    public function writeJsonSafely(
        string $path,
        array $data,
        ?string $expectedVersion = null,
        bool $createOnly = false,
    ): void {
        $json = json_encode(
            $data,
            JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
        )."\n";

        if ($this->webDavClient) {
            $headers = ['Content-Type' => 'application/json; charset=utf-8'];

            if ($createOnly) {
                $headers['If-None-Match'] = '*';
            } elseif ($expectedVersion !== null) {
                $headers['If-Match'] = $expectedVersion;
            }

            $response = $this->webDavClient->request('PUT', $this->remoteUrl($path), $json, $headers);

            if (in_array($response['statusCode'], [409, 412], true)) {
                throw new EagleWriteConflictException;
            }

            if ($response['statusCode'] < 200 || $response['statusCode'] >= 300) {
                throw new RuntimeException("OpenCloud returned {$response['statusCode']} while writing {$path}.");
            }

            return;
        }

        $exists = $this->fileExists($path);

        if ($createOnly && $exists) {
            throw new EagleWriteConflictException;
        }

        if ($expectedVersion !== null) {
            if (! $exists || ! hash_equals($expectedVersion, hash('sha256', $this->read($path)))) {
                throw new EagleWriteConflictException;
            }
        }

        $temporaryPath = "{$path}.indexframe-".bin2hex(random_bytes(6));

        try {
            $this->write($temporaryPath, $json);
            $this->move($temporaryPath, $path);
        } catch (Throwable $exception) {
            throw new RuntimeException("Unable to write {$path}.", previous: $exception);
        } finally {
            if ($this->fileExists($temporaryPath)) {
                $this->delete($temporaryPath);
            }
        }
    }

    /** @param array<string, mixed> $data */
    public function writeJsonAtomically(string $path, array $data): void
    {
        $this->writeJsonSafely($path, $data);
    }

    /**
     * @return array{
     *     body: resource,
     *     content_length: ?string,
     *     content_range: ?string,
     *     status: int,
     * }
     */
    public function remoteStream(string $path, ?string $range = null): array
    {
        if (! $this->webDavClient) {
            return [
                'body' => $this->readStream($path),
                'content_length' => (string) $this->fileSize($path),
                'content_range' => null,
                'status' => 200,
            ];
        }

        $headers = $range ? ['Range' => $range] : [];
        $request = new Request('GET', $this->remoteUrl($path), $headers);
        $response = $this->webDavClient->send($request);

        if (! in_array($response->getStatus(), [200, 206], true)) {
            throw new RuntimeException("OpenCloud returned {$response->getStatus()} while streaming {$path}.");
        }

        $body = $response->getBodyAsStream();

        if (! is_resource($body)) {
            throw new RuntimeException("OpenCloud did not return a stream for {$path}.");
        }

        return [
            'body' => $body,
            'content_length' => $response->getHeader('Content-Length'),
            'content_range' => $response->getHeader('Content-Range'),
            'status' => $response->getStatus(),
        ];
    }

    private function remoteUrl(string $path): string
    {
        $fullPath = collect([$this->webDavRoot, $path])
            ->filter(fn (string $part): bool => $part !== '')
            ->flatMap(fn (string $part) => explode('/', trim($part, '/')))
            ->map(fn (string $part): string => rawurlencode($part))
            ->implode('/');

        return $this->webDavClient->getAbsoluteUrl($fullPath);
    }

    /** @param array<string, mixed> $headers */
    private function headerValue(array $headers, string $name): ?string
    {
        $value = $headers[strtolower($name)] ?? null;

        if (is_array($value)) {
            $value = $value[0] ?? null;
        }

        return is_string($value) ? $value : null;
    }

    private function logicalAttribute(StorageAttributes $entry): StorageAttributes
    {
        $path = '/'.ltrim($entry->path(), '/');
        $marker = '/'.trim($this->webDavRoot, '/').'/';
        $position = strpos($path, $marker);

        if ($position === false) {
            return $entry;
        }

        return $entry->withPath(substr($path, $position + strlen($marker)));
    }
}
