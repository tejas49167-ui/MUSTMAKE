const API_URL = "https://justdoitbackend.vercel.app";

window.addEventListener("storage", (event) => {
    if (event.key !== "googleLoginComplete" || !event.newValue) {
        return;
    }

    localStorage.removeItem("googleLoginComplete");

    if (localStorage.getItem("token") && localStorage.getItem("user")) {
        window.location.replace("../index.html");
    }
});

const googleLoginLink = document.getElementById("googleLoginLink");
const signupLink = document.getElementById("signupLink");

if (signupLink) {
    signupLink.addEventListener("click", (event) => {
        if (
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey
        ) {
            return;
        }

        event.preventDefault();
        window.location.replace(signupLink.href);
    });
}

if (googleLoginLink) {
    googleLoginLink.addEventListener("click", (event) => {
        if (
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey
        ) {
            return;
        }

        event.preventDefault();

        const oauthWindow = window.open(googleLoginLink.href, "_blank");

        if (oauthWindow) {
            oauthWindow.opener = null;
        } else {
            // Continue to support sign-in if the browser blocks the new tab.
            window.location.replace(googleLoginLink.href);
        }
    });
}

const loginForm =
    document.getElementById("loginForm");


if (loginForm) {

    loginForm.addEventListener(
        "submit",
        async (event) => {

            event.preventDefault();


            const login =
                document
                    .getElementById("login")
                    .value
                    .trim();

            const password =
                document
                    .getElementById("password")
                    .value;


            const message =
                document.getElementById(
                    "loginMessage"
                );


            message.textContent =
                "Logging in...";


            try {

                const response =
                    await fetch(
                        `${API_URL}/api/auth/login`,
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({
                                login,
                                password
                            })
                        }
                    );


                const data =
                    await response.json();


                if (!response.ok) {

                    throw new Error(
                        data.message ||
                        "Login failed."
                    );

                }


                localStorage.setItem(
                    "token",
                    data.token
                );


                localStorage.setItem(
                    "user",
                    JSON.stringify(data.user)
                );


                message.textContent =
                    "Login successful!";


                window.location.replace(
                    "../index.html"
                );

            }

            catch (error) {

                console.error(error);

                message.textContent =
                    error instanceof TypeError
                        ? "Cannot reach the backend. Start the server from the backend folder and try again."
                        : error.message || "Could not login.";

            }

        }
    );

}
