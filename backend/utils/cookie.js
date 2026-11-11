function getCookieValue(cookieHeader, name) {
    if (typeof cookieHeader !== "string" || !cookieHeader) return null;

    for (const cookie of cookieHeader.split(";")) {
        const separator = cookie.indexOf("=");
        if (separator < 0 || cookie.slice(0, separator).trim() !== name) continue;

        return cookie.slice(separator + 1).trim();
    }

    return null;
}

module.exports = { getCookieValue };
