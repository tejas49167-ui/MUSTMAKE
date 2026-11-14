const MAX_SEARCH_GRAM_SIZE = 3;

function getUserSearchGrams(...values) {
    const grams = new Set();

    for (const value of values) {
        if (typeof value !== "string" || !value) continue;

        const characters = Array.from(value.toLowerCase());
        for (let size = 1; size <= MAX_SEARCH_GRAM_SIZE; size += 1) {
            for (let start = 0; start <= characters.length - size; start += 1) {
                grams.add(`${size}:${characters.slice(start, start + size).join("")}`);
            }
        }
    }

    return [...grams];
}

module.exports = { getUserSearchGrams };
