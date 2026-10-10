# MustMake
<p align="center">
  <img src="frontend/assets/images/favicon.jpeg" alt="MustMake" width="120">
</p>

MustMake is a fitness tracking application focused on consistency, measurable progress, and long-term improvement.

The application provides workout tracking, user authentication, and a backend API for managing user and fitness data.

## Features

- Google OAuth authentication
- OTP-based authentication
- Workout and exercise tracking
- Daily activity tracking
- Progress tracking
- User accounts
- REST API
- MongoDB data storage

## Tech Stack

- HTML
- CSS
- JavaScript
- Node.js
- Express.js
- MongoDB
- Mongoose
- Google OAuth 2.0
- Vercel

### The project is being developed incrementally, with future plans for additional fitness, automation, and AI-related functionality.

## Project Structure

```text
MUSTMAKE/
├── frontend/
│   ├── index.html
│   ├── vercel.json
│   ├── pages/
│   │   ├── index.html
│   │   ├── history.html
│   │   ├── add-workout.html
│   │   ├── login.html
│   │   ├── signup.html
│   │   ├── google-callback.html
│   │   ├── profile.html
│   │   ├── edit-profile.html
│   │   ├── user-profile.html
│   │   ├── competition.html
│   │   └── firstdetails.html
│   ├── assets/
│   │   ├── css/style.css
│   │   └── images/favicon.jpeg
│   └── js/
│       ├── core/change_backend_url.js
│       ├── shared/
│       │   ├── auth-redirect.js
│       │   ├── navbar.js
│       │   └── theme.js
│       └── features/
│           ├── auth/
│           │   ├── auth.js
│           │   ├── signup.js
│           │   └── google-callback.js
│           ├── workouts/script.js
│           ├── profile/
│           │   ├── profile.js
│           │   ├── edit-profile.js
│           │   └── user-profile.js
│           └── competition/competition.js
├── backend/
│   ├── server.js
│   ├── app.js
│   ├── config/
│   │   ├── database.js
│   │   ├── cloudinary.js
│   │   └── passport.js
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── profile.routes.js
│   │   ├── users.routes.js
│   │   ├── workouts.routes.js
│   │   └── competition.routes.js
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── profile.controller.js
│   │   ├── users.controller.js
│   │   ├── workout.controller.js
│   │   └── competition.controller.js
│   ├── services/
│   │   ├── auth.service.js
│   │   ├── email.service.js
│   │   └── workout.service.js
│   ├── models/
│   │   ├── User.js
│   │   ├── OTP.js
│   │   ├── Workout.js
│   │   └── Competition.js
│   ├── middleware/
│   │   ├── auth.js
│   │   └── error-handler.js
│   ├── utils/
│   │   ├── date.js
│   │   └── validation.js
│   ├── package.json
│   └── package-lock.json
├── .gitignore
├── Readme.md
└── SECURITY.md
```

The frontend Vercel project should use `frontend/` as its root directory so it loads `frontend/vercel.json`.
