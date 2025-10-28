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

// Serve Vite build (client/dist) in production only
const clientDist = path.join(__dirname, '..', 'client', 'dist');
const isProd = process.env.NODE_ENV === 'production';
const distIndex = path.join(clientDist, 'index.html');
if (isProd && fs.existsSync(distIndex)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res) => {
        res.sendFile(distIndex);
    });
} else {
    console.log('Development mode: serving API only. Use Vite dev server at http://localhost:5173');
}

const port = process.env.PORT || 5174;
app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
});


