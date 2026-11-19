<?php

namespace Tests\Unit;

use App\Services\EagleImageMemory;
use Tests\TestCase;

class EagleImageMemoryTest extends TestCase
{
    public function test_it_rejects_images_over_the_pixel_budget_before_decoding(): void
    {
        config()->set('eagle.derivatives.gd_maximum_pixels', 100);

        $this->assertFalse(EagleImageMemory::canDecode($this->fixture()));
    }

    public function test_it_rejects_images_that_exceed_the_available_php_memory(): void
    {
        $originalLimit = ini_get('memory_limit');
        $currentMegabytes = (int) ceil(memory_get_usage(true) / 1024 / 1024);
        ini_set('memory_limit', ($currentMegabytes + 8).'M');

        try {
            $this->assertFalse(EagleImageMemory::canDecode($this->fixture()));
        } finally {
            ini_set('memory_limit', $originalLimit);
        }
    }

    private function fixture(): string
    {
        return base_path('tests/Fixtures/netcup-webdav/Demo.library/images/DEMOASSET01.info/Grüße 🎨.png');
    }
}
