<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="csrf-token" content="{{ csrf_token() }}">
        <meta name="theme-color" content="#171714">
        <title>{{ __('Unlock :name', ['name' => config('app.name')]) }}</title>
        @vite(['resources/css/app.css'])
    </head>
    <body class="login-page">
        <main class="login-shell">
            <section class="login-card">
                <div class="login-mark" aria-hidden="true">
                    <span></span><span></span><span></span>
                </div>
                <p class="eyebrow">Private visual archive</p>
                <h1>Welcome back.</h1>
                <p class="login-copy">Enter the archive password to browse your photo, video, and mood libraries.</p>

                @if(! $passwordConfigured)
                    <div class="setup-warning">
                        Set <code>EAGLE_PASSWORD_HASH</code> before signing in.
                    </div>
                @endif

                <form method="POST" action="{{ route('login.store') }}">
                    @csrf
                    <label for="password">Archive password</label>
                    <input
                        id="password"
                        name="password"
                        type="password"
                        autocomplete="current-password"
                        autofocus
                        required
                        placeholder="••••••••••••"
                    >
                    @error('password')
                        <p class="form-error">{{ $message }}</p>
                    @enderror
                    <button type="submit" @disabled(! $passwordConfigured)>Unlock library</button>
                </form>
                <p class="login-note">Protected with an encrypted, rate-limited session.</p>
            </section>
        </main>
    </body>
</html>
