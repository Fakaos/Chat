import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { neon } from "@neondatabase/serverless";
import path from "path";
import { fileURLToPath } from 'url';
import { registerRoutes } from "./routes";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy for Railway
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Session configuration for Railway production
let sessionConfig: any = {
  secret: process.env.SESSION_SECRET || 'railway-chat-app-secret-2025',
  resave: false,
  saveUninitialized: false, // Don't create sessions until needed - security best practice
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true, // Prevent XSS access to cookies
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'strict', // CSRF protection
  },
  name: 'sessionId'
};

// For production Railway, use PostgreSQL session store
if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL?.includes('railway')) {
  const PgSession = connectPgSimple(session);
  sessionConfig.store = new PgSession({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
  });
  // Production session store configured
} else {
  // Development session store in memory
}

app.use(session(sessionConfig));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api") && process.env.NODE_ENV === 'development') {
      // Only log API requests in development, don't log response data
      console.log(`[express] ${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    // Don't expose internal error details in production
    const message = status === 500 && process.env.NODE_ENV === 'production' 
      ? 'Server error' 
      : (err.message || "Internal Server Error");
    res.status(status).json({ message });
  });

  // Serve static files for production
  const clientPath = path.join(__dirname, '../client');
  app.use(express.static(clientPath));

  // Catch-all handler for SPA routing
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
  });

  const port = process.env.PORT || 5000;
  server.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });
})();