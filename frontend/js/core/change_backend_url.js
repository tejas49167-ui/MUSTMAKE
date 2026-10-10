const API_URLS = {
    local: "http://localhost:4000",
    production: "https://mustmakebackend.vercel.app"
};

const isLocalFrontend = ["localhost", "127.0.0.1"].includes(window.location.hostname);
window.API_URL = isLocalFrontend ? API_URLS.local : API_URLS.production;
