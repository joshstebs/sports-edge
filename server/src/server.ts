// SportsEdge backend entrypoint (local dev). Loads .env FIRST, then the app.

import 'dotenv/config';
import app from './app.js';

const PORT = Number(process.env.PORT) || 3100;
const server = app.listen(PORT, () => {
  console.log(`sports-edge-server listening on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
