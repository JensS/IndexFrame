<?php

namespace App\Http\Controllers;

use App\Services\OpenCloudDirectoryBrowser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use InvalidArgumentException;
use Throwable;

class OpenCloudDirectoriesController extends Controller
{
    public function __invoke(Request $request, OpenCloudDirectoryBrowser $browser): JsonResponse
    {
        $validated = $request->validate([
            'path' => ['nullable', 'string', 'max:1024'],
        ]);

        try {
            $response = response()->json([
                'data' => $browser->browse($validated['path'] ?? '/'),
            ]);
            $response->headers->set('Cache-Control', 'no-store, private');

            return $response;
        } catch (InvalidArgumentException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        } catch (Throwable $exception) {
            report($exception);

            return response()->json([
                'message' => 'OpenCloud could not list this folder. Check the WebDAV URL, username, App Token, and permissions.',
            ], 502);
        }
    }
}
