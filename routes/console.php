<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command(config('eagle.queued_sync') ? 'eagle:sync --prune --queued' : 'eagle:sync --prune')
    ->everyTenMinutes()
    ->withoutOverlapping(30);

Schedule::command('queue:work database --stop-when-empty --max-time=45 --max-jobs=50 --tries=3 --timeout=120 --memory=384')
    ->everyMinute()
    ->withoutOverlapping(5);
