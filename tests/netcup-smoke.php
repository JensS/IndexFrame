<?php

use GuzzleHttp\Client;

require __DIR__.'/../vendor/autoload.php';

$client = new Client([
    'base_uri' => 'http://web',
    'cookies' => true,
    'http_errors' => false,
    'timeout' => 20,
]);

function check(bool $condition, string $message): void
{
    if (! $condition) {
        throw new RuntimeException($message);
    }
}

check($client->get('/up')->getStatusCode() === 200, 'Health check failed.');
check($client->get('/api/libraries', ['headers' => ['Accept' => 'application/json']])->getStatusCode() === 401, 'Guest API access must be rejected.');
$login = (string) $client->get('/login')->getBody();
check(preg_match('/name="_token" value="([^"]+)"/', $login, $matches) === 1, 'Login CSRF token missing.');
$response = $client->post('/login', [
    'form_params' => ['_token' => $matches[1], 'password' => 'netcup-local-test'],
    'allow_redirects' => false,
]);
check($response->getStatusCode() === 302, 'Login failed.');
$response = $client->get('/api/libraries');
check($response->getStatusCode() === 200, 'Database session was not retained.');
$libraries = json_decode((string) $response->getBody(), true, flags: JSON_THROW_ON_ERROR);
check(($libraries['data'][0]['slug'] ?? null) === 'demo', 'WebDAV fixture was not indexed.');
check($libraries['data'][0]['assets_count'] === 1, 'Fixture asset count differs.');
$response = $client->get('/api/libraries/demo/assets', ['query' => ['q' => 'Grüße']]);
$assets = json_decode((string) $response->getBody(), true, flags: JSON_THROW_ON_ERROR);
check(($assets['data'][0]['name'] ?? null) === 'Grüße 🎨', 'Unicode search failed.');

$response = $client->get('/media/demo/DEMOASSET01/image/640');
check($response->getStatusCode() === 200, 'GD rendition failed.');
check($response->getHeaderLine('Content-Type') === 'image/webp', 'Expected a WebP rendition.');
check(str_contains($response->getHeaderLine('Cache-Control'), 'private'), 'Renditions must remain private.');
check(getimagesizefromstring((string) $response->getBody()) !== false, 'Invalid rendition data.');
$etag = $response->getHeaderLine('ETag');
check($client->get('/media/demo/DEMOASSET01/image/640', ['headers' => ['If-None-Match' => $etag]])->getStatusCode() === 304, 'Rendition cache validation failed.');

$response = $client->get('/media/demo/DEMOASSET01/original', ['headers' => ['Range' => 'bytes=0-9']]);
check($response->getStatusCode() === 206, 'Original range request failed.');
check(strlen((string) $response->getBody()) === 10, 'Original range length differs.');
$response = $client->get('/media/demo/DEMOASSET01/download');
check($response->getStatusCode() === 200, 'Original download failed.');
check(str_contains($response->getHeaderLine('Content-Disposition'), 'attachment'), 'Download disposition missing.');
check($client->get('/.env')->getStatusCode() === 404, 'Project environment must not be publicly served.');
check($client->get('/storage/test')->getStatusCode() === 404, 'Public storage must not be exposed.');

$page = (string) $client->get('/')->getBody();
check(preg_match('/name="csrf-token" content="([^"]+)"/', $page, $matches) === 1, 'Session CSRF token missing.');
$client->post('/logout', ['form_params' => ['_token' => $matches[1]], 'allow_redirects' => false]);
check($client->get('/api/libraries', ['headers' => ['Accept' => 'application/json']])->getStatusCode() === 401, 'Logout did not invalidate the database session.');

echo "Apache/PHP 8.5 smoke test passed: login/logout, Unicode search, private GD images, range requests, downloads, and document-root isolation.\n";
