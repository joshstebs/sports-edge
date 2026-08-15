// Vercel serverless entry: mount the full Express app as a function.
// Rewrites in vercel.json send every /api/* request here.
// NOTE: server/ is ESM ("type": "module") but Vercel compiles this entry to
// CommonJS, so a static import becomes require() and throws ERR_REQUIRE_ESM
// at runtime. Load the app lazily via dynamic import() instead.
let cachedApp: unknown = null;

export default async function handler(req: unknown, res: unknown) {
  if (!cachedApp) {
    const mod = await import("../server/src/app.js");
    cachedApp = (mod as { default: unknown }).default;
  }
  return (cachedApp as (req: unknown, res: unknown) => unknown)(req, res);
}
