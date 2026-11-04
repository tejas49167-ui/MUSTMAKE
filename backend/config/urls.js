const backend_url = process.env.BACKEND_URL || "https://mustmakebackend.vercel.app";
const frontend_url = process.env.FRONTEND_URL || "https://mustmake.site";
const frontend_origins = [
    frontend_url,
    "https://www.mustmake.site",
    "https://mustmake.vercel.app",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:4000",
    "http://127.0.0.1:4000"
];

function getFrontendRedirect(path) {
    let frontend;
    try {
        frontend = new URL(frontend_url);
    } catch {
        throw new Error("FRONTEND_URL must be a valid absolute URL.");
    }

    const allowedOrigins = new Set(frontend_origins.map(origin => {
        try {
            return new URL(origin).origin;
        } catch {
            return null;
        }
    }));

    if (
        !["http:", "https:"].includes(frontend.protocol) ||
        frontend.username ||
        frontend.password ||
        !allowedOrigins.has(frontend.origin) ||
        !path.startsWith("/") ||
        path.startsWith("//")
    ) {
        throw new Error("FRONTEND_URL is not an allowed redirect destination.");
    }

    return new URL(path, frontend.origin).toString();
}

module.exports = {
    backend_url,
    frontend_url,
    frontend_origins,
    getFrontendRedirect
};
