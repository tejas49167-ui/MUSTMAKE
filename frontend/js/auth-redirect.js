window.redirectAfterAuthentication = function (user) {
    const destination = user?.dateOfBirth
        ? "../index.html"
        : "askforfirstuseraftersignup.html";

    window.location.replace(destination);
};
