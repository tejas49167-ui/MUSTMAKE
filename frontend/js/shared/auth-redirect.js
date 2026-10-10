window.redirectAfterAuthentication = function (user) {
    const destination = user?.dateOfBirth
        ? "../index.html"
        : "firstdetails.html";

    window.location.replace(destination);
};
