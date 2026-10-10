window.redirectAfterAuthentication = function (user) {
    const destination = user?.dateOfBirth
        ? "/today"
        : "/first-details";

    window.location.replace(destination);
};
