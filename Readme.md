# MustMake
<p align="center">
  <img src="frontend/assets/images/favicon.png" alt="MustMake" width="120">
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

## Worked more time to make 
- Session and pending-signup cookies are HttpOnly; production cookies are Secure and use `SameSite=None`.
- Unsafe requests require an allowed `Origin`.
- JWT verification restricts the algorithm to HS256 and validates the user ID.
- Google OAuth state is random, cookie-bound, short-lived, constant-time compared, and consumed once.
- OTP and login limits use persistent counters; OTPs are hashed, expire, and are consumed atomically.
- Workout and competition mutations are scoped to the authenticated owner.
- User-provided workout, profile, and social text is escaped before HTML insertion in the reviewed UI paths.
- Helmet/CSP headers are present; static frontend CSP is compatible with same-origin API rewrites.


### The project is being developed incrementally, with future plans for additional fitness, automation, and AI-related functionality.


## Project Structure

```text
MUSTMAKE/
├── backend/
│   ├── app.js
│   ├── server.js
│   ├── package.json
│   ├── package-lock.json
│   ├── vercel.json
│   ├── config/
│   │   ├── cloudinary.js
│   │   ├── database.js
│   │   ├── exercises.json
│   │   ├── passport.js
│   │   └── urls.js
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── auth/                 # OAuth, OTP, password/session controllers
│   │   └── other *.controller.js files
│   ├── middleware/               # Authentication, origin, OAuth state, errors
│   ├── models/                   # Mongoose models
│   ├── routes/                   # API route modules
│   ├── schemas/
│   │   └── auth.schemas.js
│   ├── scripts/
│   │   └── backfill-user-search-grams.js
│   ├── services/                 # Auth, email, OTP, Google, and workout services
│   ├── tests/                    # Backend tests
│   └── utils/                    # Cookies, dates, logging, search, validation
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vercel.json
│   ├── serve.json
│   ├── robots.txt
│   ├── sitemap.xml
│   ├── google9323a3bb1ac7a607.html
│   ├── config/
│   │   └── exercise-pages.json
│   ├── pages/
│   │   ├── exercises/            # Generated exercise pages
│   │   └── *.html                # App pages, including settings and about-us
│   ├── assets/
│   │   ├── css/
│   │   ├── images/
│   │   └── *.mp3
│   ├── js/
│   │   ├── core/                 # Backend URL and authentication guards
│   │   ├── shared/               # Shared auth, session, UI, and workout modules
│   │   └── features/
│   │       ├── auth/
│   │       ├── competition/
│   │       ├── exercises/        # Camera, pose, detection, and workout flows
│   │       ├── profile/
│   │       └── workouts/
│   ├── scripts/
│   │   └── generate-exercise-pages.mjs
│   ├── templates/
│   │   └── exercise-page.html
│   └── tests/                    # Frontend tests
├── .gitignore
├── LICENSE
├── Readme.md
└── SECURITY.md
```

## Feel free to open pull request
