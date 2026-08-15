<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AuthenticationTest extends TestCase
{
    use RefreshDatabase;

    public function test_guests_are_redirected_away_from_the_library(): void
    {
        $this->get('/')->assertRedirect('/login');
        $this->getJson('/api/libraries')->assertUnauthorized();
    }

    public function test_a_valid_password_creates_an_authenticated_session(): void
    {
        config()->set('eagle.password_hash', Hash::make('a-long-private-password'));

        $response = $this->post('/login', [
            'password' => 'a-long-private-password',
        ]);

        $response->assertRedirect('/');
        $response->assertSessionHas('eagle_authenticated', true);
        $this->get('/')->assertOk();
    }

    public function test_an_invalid_password_is_rejected(): void
    {
        config()->set('eagle.password_hash', Hash::make('a-long-private-password'));

        $this->post('/login', [
            'password' => 'the-wrong-password',
        ])->assertSessionHasErrors('password');

        $this->assertFalse(session()->get('eagle_authenticated', false));
    }
}
