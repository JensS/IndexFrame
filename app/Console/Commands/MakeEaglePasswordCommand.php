<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;

use function Laravel\Prompts\password;

class MakeEaglePasswordCommand extends Command
{
    protected $signature = 'eagle:password';

    protected $description = 'Generate an EAGLE_PASSWORD_HASH value';

    public function handle(): int
    {
        $plainTextPassword = password(
            label: 'Archive password',
            required: true,
            validate: fn (string $value) => strlen($value) < 12
                ? 'Use at least 12 characters.'
                : null,
        );

        $this->newLine();
        $this->line('Add this value to your environment:');
        $this->newLine();
        $this->line('EAGLE_PASSWORD_HASH='.Hash::make($plainTextPassword));

        return self::SUCCESS;
    }
}
