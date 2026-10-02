const API_URL = "https://justdoitbackend.vercel.app/";


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


                window.location.href =
                    "index.html";

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
