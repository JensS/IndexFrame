<?php

namespace App\Services;

use App\Models\EagleFolder;
use Illuminate\Database\Eloquent\Builder;

class SmartFolderFilter
{
    public function apply(Builder $query, EagleFolder $folder): Builder
    {
        foreach ($folder->conditions ?? [] as $condition) {
            $boolean = strtoupper((string) ($condition['boolean'] ?? 'TRUE'));

            if ($boolean === 'FALSE') {
                $query->whereNot(fn (Builder $conditionQuery) => $this->applyRules($conditionQuery, $condition));

                continue;
            }

            $query->where(fn (Builder $conditionQuery) => $this->applyRules($conditionQuery, $condition));
        }

        return $query;
    }

    /** @param array<string, mixed> $condition */
    private function applyRules(Builder $query, array $condition): void
    {
        $match = strtoupper((string) ($condition['match'] ?? 'AND'));

        foreach (array_values($condition['rules'] ?? []) as $index => $rule) {
            $boolean = $index > 0 && $match === 'OR' ? 'or' : 'and';

            $query->where(
                fn (Builder $ruleQuery) => $this->applyRule($ruleQuery, $rule),
                boolean: $boolean,
            );
        }
    }

    /** @param array<string, mixed> $rule */
    private function applyRule(Builder $query, array $rule): void
    {
        $property = $rule['property'] ?? '';
        $method = $rule['method'] ?? 'equal';
        $value = $rule['value'] ?? null;

        if ($property === 'tags') {
            $values = array_values((array) $value);

            if ($method === 'intersection') {
                foreach ($values as $tag) {
                    $query->whereJsonContains('tags', $tag);
                }

                return;
            }

            $query->where(function (Builder $tagQuery) use ($values): void {
                foreach ($values as $index => $tag) {
                    $index === 0
                        ? $tagQuery->whereJsonContains('tags', $tag)
                        : $tagQuery->orWhereJsonContains('tags', $tag);
                }
            });

            return;
        }

        $column = match ($property) {
            'name' => 'name',
            'ext' => 'extension',
            'annotation' => 'annotation',
            'url' => 'url',
            'width' => 'width',
            'height' => 'height',
            'rating' => 'rating',
            default => null,
        };

        if (! $column) {
            $query->whereRaw('1 = 0');

            return;
        }

        match ($method) {
            'contain' => $query->where($column, 'like', "%{$value}%"),
            'greater' => $query->where($column, '>', $value),
            'less' => $query->where($column, '<', $value),
            default => $query->where($column, $value),
        };
    }
}
