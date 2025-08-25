import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { neon } from "@neondatabase/serverless";
import path from "path";
import { fileURLToPath } from 'url';
import { storage, MemStorage, DatabaseStorage, IStorage } from "./storage";

// Use fallback storage if database is not available
let appStorage: IStorage;
if (process.env.DATABASE_URL) {
  try {
    appStorage = new DatabaseStorage(process.env.DATABASE_URL);
    console.log('Using PostgreSQL database storage');
  } catch (error) {
    console.warn('Failed to initialize database storage, falling back to memory storage:', error);
    appStorage = new MemStorage();
  }
} else {
  appStorage = new MemStorage();
  console.log('DATABASE_URL not found, using in-memory storage');
}

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
  saveUninitialized: true,
  cookie: {
    secure: false, // Railway uses reverse proxy, keep false
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax',
    path: '/'
  },
  name: 'sessionId'
};

// Use PostgreSQL session store if DATABASE_URL is available
if (process.env.DATABASE_URL) {
  const PgSession = connectPgSimple(session);
  sessionConfig.store = new PgSession({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
  });
  console.log('Using PostgreSQL session store');
} else {
  console.log('DATABASE_URL not found, using default MemoryStore for sessions');
}

app.use(session(sessionConfig));

// Extend Express Request type to include session
declare module 'express-serve-static-core' {
  interface Request {
    session: any;
  }
}

// CORS headers for Railway
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cookie');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Simple test endpoint
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Backend is working!', 
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV 
  });
});

// Ngrok URL management
app.get('/api/settings/ngrok-url', async (req, res) => {
  try {
    const ngrokUrl = await appStorage.getNgrokUrl();
    res.json({ ngrokUrl });
  } catch (error) {
    console.error('Error fetching ngrok URL:', error);
    res.status(500).json({ error: 'Failed to fetch ngrok URL' });
  }
});

app.post('/api/settings/ngrok-url', async (req, res) => {
  try {
    const { ngrokUrl } = req.body;
    
    if (!ngrokUrl) {
      return res.status(400).json({ error: 'ngrokUrl is required' });
    }

    await appStorage.setNgrokUrl(ngrokUrl);
    res.json({ ngrokUrl });
  } catch (error) {
    console.error('Error saving ngrok URL:', error);
    res.status(500).json({ error: 'Failed to save ngrok URL' });
  }
});

// Admin AI model endpoints
app.get('/api/admin/ai-model', async (req, res) => {
  try {
    const aiModel = await appStorage.getAiModel();
    res.json({ aiModel: aiModel || 'llama2:7b' });
  } catch (error) {
    console.error('Error fetching AI model:', error);
    res.status(500).json({ error: 'Failed to fetch AI model' });
  }
});

app.post('/api/admin/ai-model', async (req, res) => {
  try {
    const { aiModel } = req.body;
    
    if (!aiModel || typeof aiModel !== 'string') {
      return res.status(400).json({ error: 'AI model is required' });
    }

    await appStorage.setAiModel(aiModel);
    const user = req.session?.userId ? await appStorage.getUser(req.session.userId) : null;
    await appStorage.addLog('info', 'AI model changed', { newModel: aiModel }, user?.id, user?.username, 'change_ai_model');
    
    res.json({ aiModel });
  } catch (error) {
    console.error('Error saving AI model:', error);
    const user = req.session?.userId ? await appStorage.getUser(req.session.userId) : null;
    await appStorage.addLog('error', 'Failed to save AI model', { error: error instanceof Error ? error.message : 'Unknown error' }, user?.id, user?.username, 'change_ai_model');
    res.status(500).json({ error: 'Failed to save AI model' });
  }
});

// Logs endpoints
app.get('/api/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const logs = await appStorage.getLogs(limit);
    res.json({ logs });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

app.get('/api/errors', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const errors = await appStorage.getErrors(limit);
    res.json({ errors });
  } catch (error) {
    console.error('Error fetching errors:', error);
    res.status(500).json({ error: 'Failed to fetch errors' });
  }
});

// Auth endpoints
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const existingUser = await appStorage.getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const user = await appStorage.createUser({ username, password });
    await appStorage.addLog('info', 'User registered', { username }, user.id, username, 'register');
    
    if (req.session) {
      req.session.userId = user.id;
      await new Promise((resolve, reject) => {
        req.session.save((err: any) => {
          if (err) {
            console.error('Registration session save error:', err);
            reject(err);
          } else {
            console.log('Registration session saved for user:', user.id);
            resolve(true);
          }
        });
      });
    }
    
    res.json({ 
      success: true, 
      user: { id: user.id, username: user.username } 
    });
  } catch (error) {
    console.error('Registration error:', error);
    await appStorage.addLog('error', 'Registration failed', { error: error instanceof Error ? error.message : 'Unknown error' }, undefined, req.body.username, 'register');
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = await appStorage.getUserByUsername(username);
    if (!user || user.password !== password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (req.session) {
      req.session.userId = user.id;
      await new Promise((resolve, reject) => {
        req.session.save((err: any) => {
          if (err) {
            console.error('Login session save error:', err);
            reject(err);
          } else {
            console.log('Login session saved for user:', user.id);
            resolve(true);
          }
        });
      });
    }
    
    await appStorage.addLog('info', 'User logged in', { username }, user.id, username, 'login');
    
    res.json({ 
      success: true, 
      user: { id: user.id, username: user.username } 
    });
  } catch (error) {
    console.error('Login error:', error);
    await appStorage.addLog('error', 'Login failed', { error: error instanceof Error ? error.message : 'Unknown error' }, undefined, req.body.username, 'login');
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err: any) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

app.get('/api/auth/me', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await appStorage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({ 
      user: { id: user.id, username: user.username } 
    });
  } catch (error) {
    console.error('Auth check error:', error);
    res.status(500).json({ error: 'Auth check failed' });
  }
});

// Chat endpoints
app.get('/api/chats', async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const chats = await appStorage.getUserChats(userId);
    res.json({ chats });
  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

app.post('/api/chats', async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { title } = req.body;
    
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const chat = await appStorage.createChat({ userId, title });
    res.json({ chat });
  } catch (error) {
    console.error('Error creating chat:', error);
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

app.get('/api/chats/:chatId/messages', async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { chatId } = req.params;
    
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const messages = await appStorage.getChatMessages(chatId);
    res.json({ messages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.post('/api/chats/:chatId/messages', async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { chatId } = req.params;
    const { type, content } = req.body;
    
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const message = await appStorage.createMessage({ chatId, type, content });
    res.json({ message });
  } catch (error) {
    console.error('Error creating message:', error);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

app.put('/api/chats/:chatId', async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { chatId } = req.params;
    const { title } = req.body;
    
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const chat = await appStorage.updateChat(chatId, title);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    res.json({ chat });
  } catch (error) {
    console.error('Error updating chat:', error);
    res.status(500).json({ error: 'Failed to update chat' });
  }
});

app.delete('/api/chats/:chatId', async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { chatId } = req.params;
    
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const deleted = await appStorage.deleteChat(chatId);
    res.json({ success: deleted });
  } catch (error) {
    console.error('Error deleting chat:', error);
    res.status(500).json({ error: 'Failed to delete chat' });
  }
});

// Proxy endpoint for ngrok communication
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, model, stream, ngrokUrl } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const requestBody = {
      model: model || "llama2:7b",
      prompt: prompt,
      stream: stream || false
    };

    const targetUrl = ngrokUrl || 'https://0c8125184293.ngrok-free.app';
    const fullUrl = `${targetUrl}/api/generate`;

    console.log('JSON posílaný na ngrok:', JSON.stringify(requestBody, null, 2));
    console.log('Target URL:', fullUrl);

    // Forward request to ngrok endpoint
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'ReplichatBot/1.0'
      },
      body: JSON.stringify(requestBody)
    });

    console.log(`Ngrok response status: ${response.status} ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log('Ngrok error response:', errorText.substring(0, 200));
      throw new Error(`Ngrok API error: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.log('Non-JSON response from ngrok:', text.substring(0, 200));
      throw new Error('Ngrok endpoint returned non-JSON response (probably HTML error page)');
    }

    const data = await response.json();
    res.json(data);
    
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ 
      error: 'Failed to connect to AI service',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Serve static files (built frontend)
const staticPath = path.resolve(__dirname, 'public');
app.use(express.static(staticPath));

// Catch-all handler for frontend routing
app.get('*', (req, res) => {
  res.sendFile(path.resolve(staticPath, 'index.html'));
});

// Error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  res.status(status).json({ message });
});

const port = parseInt(process.env.PORT || '5000', 10);
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});