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

module.exports = {
    backend_url,
    frontend_url,
    frontend_origins
};
