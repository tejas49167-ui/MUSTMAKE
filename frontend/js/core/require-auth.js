try {
    const isAuthenticated = Boolean(
        JSON.parse(localStorage.getItem("user") || "null")
    );
    if (!isAuthenticated) window.location.replace("/");
} catch {
    window.location.replace("/");
}
