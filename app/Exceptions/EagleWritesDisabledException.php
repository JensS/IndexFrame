<?php

namespace App\Exceptions;

use Symfony\Component\HttpKernel\Exception\ServiceUnavailableHttpException;

class EagleWritesDisabledException extends ServiceUnavailableHttpException
{
    public function __construct()
    {
        parent::__construct(
            retryAfter: null,
            message: 'Library writes are disabled. Set EAGLE_WRITES_ENABLED=true only after running eagle:audit and taking a library backup.',
        );
    }
}
