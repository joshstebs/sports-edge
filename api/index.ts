// Vercel serverless entry: mount the full Express app as a function.
// Rewrites in vercel.json send every /api/* request here.
import app from '../server/src/app.js';

export default app;
