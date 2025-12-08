import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { initDb } from './lib/db.js';
import registerApiRoutes from './routes/api.js';
import cookieParser from 'cookie-parser';
import { registerWorkosRoutes } from './lib/workos.js';
import cron from 'node-cron';
import { createAuditProof } from './lib/audit.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// Initialize database
await initDb();




// Static for uploaded assets (local fallback when Chainletter not configured)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API routes
registerApiRoutes(app);

// Auth routes (WorkOS)
registerWorkosRoutes(app);

// Schedule daily audit proof at 5pm Eastern
cron.schedule(
  '0 17 * * *',
  async () => {
    try {
      await createAuditProof({ source: 'cron', stampImmediately: true });
      console.log('[audit] Daily audit proof generated at', new Date().toISOString());
    } catch (err) {
      console.error('[audit] Failed to generate daily audit proof', err?.message || err);
    }
  },
  { timezone: 'America/New_York' }
);

// Serve Vite build (client/dist) if it exists
const clientDist = path.join(__dirname, '..', 'client', 'dist');
const distIndex = path.join(clientDist, 'index.html');
const distExists = fs.existsSync(distIndex);

if (distExists) {
  // Serve static files from the dist directory
  app.use(express.static(clientDist, { index: false }));

  // SPA fallback: serve index.html for all non-API routes
  // This must be last, after all API routes
  app.get('*', (req, res) => {
    // Only serve index.html for routes that aren't API/auth routes
    // API routes are already handled above, so this catch-all is safe
    res.sendFile(distIndex);
  });
  console.log(`Serving React app from ${clientDist}`);
} else {
  console.warn(`React build not found at ${distIndex}. Serving API only.`);
  console.warn('Make sure to run "npm run build" before starting the server in production.');
}

const port = process.env.PORT || 5174;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});


