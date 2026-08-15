<?php

namespace App\Exceptions;

use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

class EagleWriteConflictException extends ConflictHttpException
{
    public function __construct(string $message = 'The asset changed in OpenCloud while it was being edited. Refresh and try again.')
    {
        parent::__construct($message);
    }
}
