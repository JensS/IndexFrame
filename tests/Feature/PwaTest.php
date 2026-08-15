<?php

namespace Tests\Feature;

use Tests\TestCase;

class PwaTest extends TestCase
{
    public function test_authenticated_library_exposes_pwa_metadata(): void
    {
        $this->withSession(['eagle_authenticated' => true])
            ->get('/')
            ->assertOk()
            ->assertSee('/manifest.webmanifest', false)
            ->assertSee('/icons/indexframe-192.png', false);

        $manifest = json_decode(file_get_contents(public_path('manifest.webmanifest')), true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame('standalone', $manifest['display']);
        $this->assertSame('/', $manifest['start_url']);
        $this->assertSame('Indexframe', $manifest['name']);
        $this->assertFileExists(public_path('sw.js'));
        $this->assertFileExists(public_path('icons/indexframe-192.png'));
        $this->assertFileExists(public_path('icons/indexframe-512.png'));
    }

    public function test_service_worker_has_explicit_private_cache_cleanup(): void
    {
        $serviceWorker = file_get_contents(public_path('sw.js'));

        $this->assertStringContainsString('CLEAR_PRIVATE_CACHES', $serviceWorker);
        $this->assertStringContainsString('indexframe-offline-assets-', $serviceWorker);
        $this->assertStringContainsString('indexframe-offline-libraries-', $serviceWorker);
        $this->assertStringContainsString('CACHE_LIBRARY', $serviceWorker);
        $this->assertStringContainsString('CANCEL_LIBRARY_CACHE', $serviceWorker);
        $this->assertStringContainsString("shell.delete('/')", $serviceWorker);
    }
}
