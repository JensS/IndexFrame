export function buildJustifiedRows(assets, width, targetHeight, gap = 8) {
    if (width <= 0) {
        return [];
    }

    const rows = [];
    let pending = [];
    let aspectTotal = 0;

    function finishRow(last = false) {
        const availableWidth = Math.max(1, width - gap * (pending.length - 1));
        const fittedHeight = availableWidth / aspectTotal;
        const height = last ? Math.min(targetHeight, fittedHeight) : fittedHeight;
        rows.push({
            height,
            items: pending.map((item) => ({ asset: item.asset, width: item.aspect * height })),
        });
        pending = [];
        aspectTotal = 0;
    }

    for (const asset of assets) {
        const aspect = asset.width && asset.height ? Math.max(0.35, Math.min(3, asset.width / asset.height)) : 1;
        pending.push({ asset, aspect });
        aspectTotal += aspect;

        if (aspectTotal * targetHeight + gap * (pending.length - 1) >= width) {
            finishRow();
        }
    }

    if (pending.length) {
        finishRow(true);
    }

    return rows;
}
