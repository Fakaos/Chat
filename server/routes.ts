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
      await storage.addLog('info', 'Ngrok URL changed', { newUrl: ngrokUrl });
      res.json({ success: true, ngrokUrl });
    } catch (error) {
      console.error('Error saving ngrok URL:', error);
      await storage.addLog('error', 'Failed to save ngrok URL', { error: error instanceof Error ? error.message : 'Unknown error' });
      res.status(500).json({ error: 'Failed to save ngrok URL' });
    }
  });

  // Endpoint pro načtení logů
  app.get('/api/logs', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const logs = await storage.getLogs(limit);
      res.json({ logs });
    } catch (error) {
      console.error('Error fetching logs:', error);
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  // Endpoint pro načtení errorů
  app.get('/api/errors', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const errors = await storage.getErrors(limit);
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

      // Check if user already exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ error: 'Username already exists' });
      }

      // Create user (in real app, hash password)
      const user = await storage.createUser({ username, password });
      await storage.addLog('info', 'User registered', { username });
      
      // Set session
      req.session.userId = user.id;
      
      res.json({ 
        success: true, 
        user: { id: user.id, username: user.username } 
      });
    } catch (error) {
      console.error('Registration error:', error);
      await storage.addLog('error', 'Registration failed', { error: error instanceof Error ? error.message : 'Unknown error' });
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
      }

      const user = await storage.getUserByUsername(username);
      if (!user || user.password !== password) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Set session
      req.session.userId = user.id;
      await storage.addLog('info', 'User logged in', { username });
      
      res.json({ 
        success: true, 
        user: { id: user.id, username: user.username } 
      });
    } catch (error) {
      console.error('Login error:', error);
      await storage.addLog('error', 'Login failed', { error: error instanceof Error ? error.message : 'Unknown error' });
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
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const user = await storage.getUser(userId);
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
      const userId = req.session.userId;
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const chats = await storage.getUserChats(userId);
      res.json({ chats });
    } catch (error) {
      console.error('Error fetching chats:', error);
      res.status(500).json({ error: 'Failed to fetch chats' });
    }
  });

  app.post('/api/chats', async (req, res) => {
    try {
      const userId = req.session.userId;
      const { title } = req.body;
      
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const chat = await storage.createChat({ userId, title });
      res.json({ chat });
    } catch (error) {
      console.error('Error creating chat:', error);
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
      res.json({ messages });
    } catch (error) {
      console.error('Error fetching messages:', error);
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
      res.json({ message });
    } catch (error) {
      console.error('Error creating message:', error);
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

      res.json({ chat });
    } catch (error) {
      console.error('Error updating chat:', error);
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
      res.json({ success: deleted });
    } catch (error) {
      console.error('Error deleting chat:', error);
      res.status(500).json({ error: 'Failed to delete chat' });
    }
  });

  // use storage to perform CRUD operations on the storage interface
  // e.g. storage.insertUser(user) or storage.getUserByUsername(username)

  const httpServer = createServer(app);

  return httpServer;
}
