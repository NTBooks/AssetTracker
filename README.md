Asset Tracker - Express + Vite

Quick start

1. Copy `.env.example` to `.env` and set values.
2. Install deps: `npm install`
3. Dev: `npm run dev` (server http://localhost:5174, client http://localhost:5173)
4. Build: `npm run build` then `npm start` to serve built client from Express.

Environment

FREEMODE=true to bypass Stripe during development.

Required (when not using FREEMODE):

- STRIPE_SECRET_KEY

Optional (Chainletter uploads):

- CHAINLETTER_API_KEY
- CHAINLETTER_SECRET_KEY

Theme

Set THEME_JSON to override autumn colors at build time. Example:

THEME_JSON='{"autumn":{"500":"#e76f51"}}' npm run build
