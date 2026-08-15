<?php

namespace App\Providers;

use App\Services\EagleStorage;
use App\Services\OpenCloudDirectoryBrowser;
use App\Services\OpenCloudPathMapper;
use Illuminate\Support\ServiceProvider;
use League\Flysystem\Filesystem;
use League\Flysystem\Local\LocalFilesystemAdapter;
use League\Flysystem\WebDAV\WebDAVAdapter;
use RuntimeException;
use Sabre\DAV\Client;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->singleton(EagleStorage::class, function (): EagleStorage {
            if (app()->environment('testing')) {
                $root = (string) config('eagle.testing_root', base_path());
                $filesystem = new Filesystem(new LocalFilesystemAdapter($root));

                return new EagleStorage($filesystem);
            }

            $client = $this->webDavClient();
            $root = trim((string) config('eagle.webdav.root'), '/');
            $username = (string) config('eagle.webdav.username');
            $password = $this->webDavPassword();
            $adapter = new WebDAVAdapter($client, $root, manualCopy: true, manualMove: false);
            $pathMapper = new OpenCloudPathMapper((string) config('eagle.webdav.url'));

            return new EagleStorage(
                new Filesystem($adapter),
                $client,
                $root,
                $pathMapper,
                $username,
                $password,
                (bool) config('eagle.webdav.verify_tls'),
            );
        });

        $this->app->singleton(OpenCloudDirectoryBrowser::class, function (): OpenCloudDirectoryBrowser {
            if (app()->environment('testing')) {
                $root = (string) config('eagle.testing_root', base_path());
                $filesystem = new Filesystem(new LocalFilesystemAdapter($root));

                return new OpenCloudDirectoryBrowser($filesystem, (string) config('eagle.webdav.root', '/'));
            }

            $adapter = new WebDAVAdapter($this->webDavClient(), '', manualCopy: true, manualMove: false);
            $pathMapper = new OpenCloudPathMapper((string) config('eagle.webdav.url'));

            return new OpenCloudDirectoryBrowser(
                new Filesystem($adapter),
                (string) config('eagle.webdav.root', '/'),
                $pathMapper,
            );
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }

    private function webDavPassword(): string
    {
        $passwordFile = config('eagle.webdav.password_file');

        if (is_string($passwordFile) && $passwordFile !== '') {
            $resolvedPasswordFile = is_file($passwordFile) ? $passwordFile : base_path($passwordFile);

            if (is_file($resolvedPasswordFile)) {
                return trim((string) file_get_contents($resolvedPasswordFile));
            }
        }

        return (string) config('eagle.webdav.password');
    }

    private function webDavClient(): Client
    {
        $url = rtrim((string) config('eagle.webdav.url'), '/').'/';
        $username = (string) config('eagle.webdav.username');
        $password = $this->webDavPassword();

        if ($url === '/' || $username === '' || $password === '') {
            throw new RuntimeException('EAGLE_WEBDAV_URL, EAGLE_WEBDAV_USERNAME, and an App Token are required.');
        }

        $client = new Client([
            'baseUri' => $url,
            'userName' => $username,
            'password' => $password,
            'authType' => Client::AUTH_BASIC,
        ]);

        if (! config('eagle.webdav.verify_tls')) {
            $client->addCurlSetting(CURLOPT_SSL_VERIFYHOST, 0);
            $client->addCurlSetting(CURLOPT_SSL_VERIFYPEER, false);
        }

        return $client;
    }
}
