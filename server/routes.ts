import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

// Extend Express Request type to include session
declare module 'express-serve-static-core' {
  interface Request {
    session: any;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // CORS and error handling middleware  
  app.use('/api', (req, res, next) => {
    // Add CORS headers for Railway - can't use * with credentials
    const origin = req.headers.origin;
    if (origin) {
      res.header('Access-Control-Allow-Origin', origin);
    } else {
      // Fallback for direct requests
      res.header('Access-Control-Allow-Origin', 'http://localhost:5000');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cookie');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // put application routes here
  // prefix all routes with /api
  
  // Simple test endpoint
  app.get('/api/test', (req, res) => {
    res.json({ 
      message: 'Backend is working!', 
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV 
    });
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

      await storage.addLog('info', `AI request to ${fullUrl}`, { prompt: prompt.substring(0, 100) });

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
        await storage.addLog('error', `Ngrok API error: ${response.status}`, { url: fullUrl, error: errorText.substring(0, 200) });
        throw new Error(`Ngrok API error: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.log('Non-JSON response from ngrok:', text.substring(0, 200));
        await storage.addLog('error', 'Ngrok returned non-JSON response', { url: fullUrl, response: text.substring(0, 200) });
        throw new Error('Ngrok endpoint returned non-JSON response (probably HTML error page)');
      }

      const data = await response.json();
      await storage.addLog('info', 'AI request successful', { responseLength: JSON.stringify(data).length });
      res.json(data);
      
    } catch (error) {
      console.error('Proxy error:', error);
      await storage.addLog('error', 'Proxy error in /api/generate', { error: error instanceof Error ? error.message : 'Unknown error' });
      res.status(500).json({ 
        error: 'Failed to connect to AI service',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Endpoint pro načtení ngrok URL
  app.get('/api/settings/ngrok-url', async (req, res) => {
    try {
      const setting = await storage.getSettingByKey('ngrok_url');
      const ngrokUrl = setting?.value || 'https://0c8125184293.ngrok-free.app';
      res.json({ ngrokUrl });
    } catch (error) {
      console.error('Error fetching ngrok URL:', error);
      res.status(500).json({ error: 'Failed to fetch ngrok URL' });
    }
  });

  // Endpoint pro uložení ngrok URL
  app.post('/api/settings/ngrok-url', async (req, res) => {
    try {
      const { ngrokUrl } = req.body;
      
      if (!ngrokUrl || typeof ngrokUrl !== 'string') {
        return res.status(400).json({ error: 'Invalid ngrok URL' });
      }

      await storage.upsertSetting('ngrok_url', ngrokUrl);
      const user = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      await storage.addLog('info', 'Ngrok URL changed', { newUrl: ngrokUrl }, user?.id, user?.username, 'change_ngrok_url');
      res.json({ success: true, ngrokUrl });
    } catch (error) {
      console.error('Error saving ngrok URL:', error);
      const user = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      await storage.addLog('error', 'Failed to save ngrok URL', { error: error instanceof Error ? error.message : 'Unknown error' }, user?.id, user?.username, 'change_ngrok_url');
      res.status(500).json({ error: 'Failed to save ngrok URL' });
    }
  });

  // Endpoint pro načtení logů
  app.get('/api/logs', async (req, res) => {
    try {
      console.log('Fetching logs, session:', !!req.session);
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await storage.getLogs(limit);
      console.log('Found logs:', logs.length);
      res.json({ logs });
    } catch (error) {
      console.error('Error fetching logs:', error);
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  // Endpoint pro načtení errorů
  app.get('/api/errors', async (req, res) => {
    try {
      console.log('Fetching errors, session:', !!req.session);
      const limit = parseInt(req.query.limit as string) || 50;
      const errors = await storage.getErrors(limit);
      console.log('Found errors:', errors.length);
      res.json({ errors });
    } catch (error) {
      console.error('Error fetching errors:', error);
      res.status(500).json({ error: 'Failed to fetch errors' });
    }
  });

  // Auth endpoints
  app.post('/api/auth/register', async (req, res) => {
    try {
      console.log('Registration attempt:', { body: req.body, hasSession: !!req.session });
      
      const { username, password } = req.body;
      
      if (!username || !password) {
        console.log('Missing username or password');
        return res.status(400).json({ error: 'Username and password required' });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        console.log('User already exists:', username);
        return res.status(400).json({ error: 'Username already exists' });
      }

      // Create user (in real app, hash password)
      const user = await storage.createUser({ username, password });
      await storage.addLog('info', 'User registered', { username }, user.id, username, 'register');
      
      // Set session with explicit save
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
      } else {
        console.log('No session available');
      }
      
      res.json({ 
        success: true, 
        user: { id: user.id, username: user.username } 
      });
    } catch (error) {
      console.error('Registration error:', error);
      await storage.addLog('error', 'Registration failed', { error: error instanceof Error ? error.message : 'Unknown error' }, undefined, req.body.username, 'register');
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      console.log('Login attempt:', { body: req.body, hasSession: !!req.session });
      
      const { username, password } = req.body;
      
      if (!username || !password) {
        console.log('Missing username or password');
        return res.status(400).json({ error: 'Username and password required' });
      }

      const user = await storage.getUserByUsername(username);
      if (!user || user.password !== password) {
        console.log('Invalid credentials for user:', username);
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Set session with explicit save
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
      } else {
        console.log('No session available');
      }
      
      await storage.addLog('info', 'User logged in', { username }, user.id, username, 'login');
      
      res.json({ 
        success: true, 
        user: { id: user.id, username: user.username } 
      });
    } catch (error) {
      console.error('Login error:', error);
      await storage.addLog('error', 'Login failed', { error: error instanceof Error ? error.message : 'Unknown error' }, undefined, req.body.username, 'login');
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
      console.log('Auth check:', { 
        hasSession: !!req.session, 
        sessionUserId: req.session?.userId,
        sessionId: req.session?.id,
        cookies: req.headers.cookie,
        sessionData: req.session
      });
      
      if (!req.session) {
        console.log('No session object');
        return res.status(401).json({ error: 'Not authenticated' });
      }
      
      const userId = req.session.userId;
      if (!userId) {
        console.log('No userId in session, regenerating session');
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        console.log('User not found:', userId);
        return res.status(401).json({ error: 'User not found' });
      }

      console.log('Auth successful for user:', user.id);
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
      console.log('Fetching chats for session:', { 
        hasSession: !!req.session, 
        sessionUserId: req.session?.userId,
        cookies: req.headers.cookie?.substring(0, 100) 
      });
      
      const userId = req.session?.userId;
      if (!userId) {
        console.log('Chats request - no userId in session');
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const chats = await storage.getUserChats(userId);
      const user = await storage.getUser(userId);
      await storage.addLog('info', 'User fetched chats', { chatCount: chats.length }, userId, user?.username, 'fetch_chats');
      console.log(`Found ${chats.length} chats for user ${userId}`);
      res.json({ chats });
    } catch (error) {
      console.error('Error fetching chats:', error);
      const user = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      await storage.addLog('error', 'Failed to fetch chats', { error: error instanceof Error ? error.message : 'Unknown error' }, user?.id, user?.username, 'fetch_chats');
      res.status(500).json({ error: 'Failed to fetch chats' });
    }
  });

  app.post('/api/chats', async (req, res) => {
    try {
      console.log('Creating chat for session:', { 
        hasSession: !!req.session, 
        sessionUserId: req.session?.userId,
        body: req.body,
        cookies: req.headers.cookie?.substring(0, 100) 
      });
      
      const userId = req.session?.userId;
      const { title } = req.body;
      
      if (!userId) {
        console.log('Chat creation - no userId in session');
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const chat = await storage.createChat({ userId, title });
      const user = await storage.getUser(userId);
      await storage.addLog('info', 'User created chat', { chatId: chat.id, title }, userId, user?.username, 'create_chat');
      console.log('Chat created successfully:', chat.id);
      res.json({ chat });
    } catch (error) {
      console.error('Error creating chat:', error);
      const user = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      await storage.addLog('error', 'Failed to create chat', { error: error instanceof Error ? error.message : 'Unknown error', title: req.body.title }, user?.id, user?.username, 'create_chat');
      res.status(500).json({ error: 'Failed to create chat' });
    }
  });

  app.get('/api/chats/:chatId/messages', async (req, res) => {
    try {
      const userId = req.session.userId;
      const { chatId } = req.params;
      
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const messages = await storage.getChatMessages(chatId);
      const user = await storage.getUser(userId);
      await storage.addLog('info', 'User fetched messages', { chatId, messageCount: messages.length }, userId, user?.username, 'fetch_messages');
      res.json({ messages });
    } catch (error) {
      console.error('Error fetching messages:', error);
      const user = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      await storage.addLog('error', 'Failed to fetch messages', { error: error instanceof Error ? error.message : 'Unknown error', chatId: req.params.chatId }, user?.id, user?.username, 'fetch_messages');
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  app.post('/api/chats/:chatId/messages', async (req, res) => {
    try {
      const userId = req.session.userId;
      const { chatId } = req.params;
      const { type, content } = req.body;
      
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const message = await storage.createMessage({ chatId, type, content });
      const user = await storage.getUser(userId);
      await storage.addLog('info', 'User created message', { chatId, messageId: message.id, type, contentLength: content?.length || 0 }, userId, user?.username, 'create_message');
      res.json({ message });
    } catch (error) {
      console.error('Error creating message:', error);
      const user = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      await storage.addLog('error', 'Failed to create message', { error: error instanceof Error ? error.message : 'Unknown error', chatId: req.params.chatId, type: req.body.type }, user?.id, user?.username, 'create_message');
      res.status(500).json({ error: 'Failed to create message' });
    }
  });

  app.put('/api/chats/:chatId', async (req, res) => {
    try {
      const userId = req.session.userId;
      const { chatId } = req.params;
      const { title } = req.body;
      
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const chat = await storage.updateChat(chatId, title);
      if (!chat) {
        return res.status(404).json({ error: 'Chat not found' });
      }
      
      const user = await storage.getUser(userId);
      await storage.addLog('info', 'User updated chat', { chatId, newTitle: title }, userId, user?.username, 'update_chat');
      res.json({ chat });
    } catch (error) {
      console.error('Error updating chat:', error);
      const user = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      await storage.addLog('error', 'Failed to update chat', { error: error instanceof Error ? error.message : 'Unknown error', chatId: req.params.chatId, title: req.body.title }, user?.id, user?.username, 'update_chat');
      res.status(500).json({ error: 'Failed to update chat' });
    }
  });

  app.delete('/api/chats/:chatId', async (req, res) => {
    try {
      const userId = req.session.userId;
      const { chatId } = req.params;
      
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const deleted = await storage.deleteChat(chatId);
      const user = await storage.getUser(userId);
      await storage.addLog('info', 'User deleted chat', { chatId, success: deleted }, userId, user?.username, 'delete_chat');
      res.json({ success: deleted });
    } catch (error) {
      console.error('Error deleting chat:', error);
      const user = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      await storage.addLog('error', 'Failed to delete chat', { error: error instanceof Error ? error.message : 'Unknown error', chatId: req.params.chatId }, user?.id, user?.username, 'delete_chat');
      res.status(500).json({ error: 'Failed to delete chat' });
    }
  });

  // use storage to perform CRUD operations on the storage interface
  // e.g. storage.insertUser(user) or storage.getUserByUsername(username)

  const httpServer = createServer(app);

  return httpServer;
}
