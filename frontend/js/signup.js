
const API_URL = "https://justdoitbackend.vercel.app";

const loginLink = document.getElementById("loginLink");

if (loginLink) {
    loginLink.addEventListener("click", (event) => {
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
        window.location.replace(loginLink.href);
    });
}


const signupForm =
    document.getElementById("signupForm");


if (signupForm) {

    signupForm.addEventListener(
        "submit",
        async (event) => {

            event.preventDefault();


            const name =
                document
                    .getElementById("name")
                    .value
                    .trim();


            const username =
                document
                    .getElementById("username")
                    .value
                    .trim();


            const email =
                document
                    .getElementById("email")
                    .value
                    .trim();


            const password =
                document
                    .getElementById("password")
                    .value;


            const message =
                document.getElementById(
                    "signupMessage"
                );


            message.textContent =
                "Creating account...";


            try {

                const response =
                    await fetch(
                        `${API_URL}/api/auth/signup`,
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body: JSON.stringify({
                                name,
                                username,
                                email,
                                password
                            })
                        }
                    );


                const data =
                    await response.json();


                if (!response.ok) {

                    throw new Error(
                        data.message ||
                        "Could not create account."
                    );

                }


                message.textContent =
                    "Account created! Redirecting...";


                window.location.replace(
                    "login.html"
                );


            } catch (error) {

                console.error(error);


                message.textContent =
                    error instanceof TypeError
                        ? "Cannot reach the backend. Start the server from the backend folder and try again."
                        : error.message || "Could not create account.";

            }

        }
    );

}
