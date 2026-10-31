# AplaJansevak | आपला जनसेवक

**Your Voice, Our Responsibility.**

AplaJansevak is an AI-assisted civic grievance-management platform being piloted for Ward No. 6 in Bhiwandi, Maharashtra. This foundation provides the citizen-facing interface and a secure Express API starting point; authentication, complaint submission, database storage, and AI workflows are intentionally future work.

## Architecture

- `client/` — React + Vite citizen interface
- `server/` — Express API with Helmet, CORS, dotenv, and a health endpoint
- `database/` — reserved for PostgreSQL/PostGIS schema and migrations
- `docs/` — project documentation

## Run locally

Open two terminals from the project root:

```powershell
cd client; npm run dev
cd server; npm run dev
```

The client runs at `http://localhost:5173`; the API health endpoint is `http://localhost:5000/api/health`.

## Available today

- Responsive citizen homepage and civic-service overview
- Separate citizen registration/login and municipal staff-login interfaces
- Client-side registration validation
- `GET /api/health` API endpoint

The interface clearly marks authentication, issue submission, and tracking as not yet connected. No passwords or accounts are stored in the browser.

## Environment

Copy `client/.env.example` or `server/.env.example` to `.env` only if configuration needs changing. Never commit actual `.env` files.
