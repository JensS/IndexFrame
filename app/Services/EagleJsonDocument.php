<?php

namespace App\Services;

readonly class EagleJsonDocument
{
    /** @param array<string, mixed> $data */
    public function __construct(
        public array $data,
        public string $version,
    ) {}
}
