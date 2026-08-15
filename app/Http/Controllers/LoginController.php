<?php

namespace App\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\View\View;

class LoginController extends Controller
{
    public function create(Request $request): View|RedirectResponse
    {
        if ($request->session()->get('eagle_authenticated') === true) {
            return redirect()->route('library');
        }

        return view('login', [
            'passwordConfigured' => filled(config('eagle.password_hash')),
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $request->validate([
            'password' => ['required', 'string'],
        ]);

        $key = "eagle-login:{$request->ip()}";

        if (RateLimiter::tooManyAttempts($key, 5)) {
            return back()
                ->withErrors(['password' => __('Too many attempts. Try again in :seconds seconds.', [
                    'seconds' => RateLimiter::availableIn($key),
                ])])
                ->onlyInput();
        }

        $passwordHash = config('eagle.password_hash');

        if (! is_string($passwordHash) || ! Hash::check($request->string('password')->toString(), $passwordHash)) {
            RateLimiter::hit($key, 60);

            return back()->withErrors(['password' => __('That password is not correct.')])->onlyInput();
        }

        RateLimiter::clear($key);
        $request->session()->regenerate();
        $request->session()->put('eagle_authenticated', true);

        return redirect()->intended(route('library'));
    }

    public function destroy(Request $request): RedirectResponse
    {
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect()->route('login');
    }
}
