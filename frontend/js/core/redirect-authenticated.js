try {
    const isAuthenticated = Boolean(
        JSON.parse(localStorage.getItem("user") || "null")
    );
    if (isAuthenticated) window.location.replace("/today");
} catch {
    // Invalid stored authentication data is treated as a guest session.
}
