import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import bcrypt from "bcrypt";
import axios from "axios";

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

  // Simple test endpoint
  app.get('/api/test', async (req, res) => {
    await storage.addLog('info', 'Test endpoint accessed', { timestamp: new Date().toISOString() });
    res.json({ 
      message: 'Backend is working!', 
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV 
    });
  });

  // Debug endpoints
  app.post('/api/test/add-logs', async (req, res) => {
    try {
      const { message, level, data } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      const logLevel = level || 'info';
      await storage.addLog(logLevel, message, data || {});
      
      res.json({ 
        success: true, 
        message: 'Log added successfully',
        logData: { level: logLevel, message, data } 
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to add log' });
    }
  });

  app.post('/api/debug/network', async (req, res) => {
    try {
      const { targetUrl } = req.body;
      const testUrl = targetUrl || 'https://httpbin.org/get';
      
      await storage.addLog('info', `Network debug test to ${testUrl}`, { targetUrl: testUrl });

      const response = await fetch(testUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DebugBot/1.0)',
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(10000)
      });

      const responseData = await response.text();
      
      await storage.addLog('info', 'Network debug test successful', { 
        status: response.status,
        responseLength: responseData.length
      });

      res.json({
        success: true,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        data: responseData.substring(0, 500) // Limit response data
      });
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      await storage.addLog('error', 'Network debug test failed', { 
        error: errorMessage,
        targetUrl: req.body.targetUrl
      });

      res.status(500).json({
        success: false,
        error: errorMessage
      });
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

      // Hash password before storing
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      const user = await storage.createUser({ username, password: hashedPassword });
      await storage.addLog('info', 'User registered', { username }, user.id, username, 'register');
      
      // Set session with explicit save
      if (req.session) {
        req.session.userId = user.id;
        await new Promise((resolve, reject) => {
          req.session.save((err: any) => {
            if (err) {
              reject(err);
            } else {
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
      await storage.addLog('error', 'Registration failed', { error: error instanceof Error ? error.message : 'Unknown error' }, undefined, req.body.username, 'register');
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
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Verify password using bcrypt
      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Set session with explicit save
      if (req.session) {
        req.session.userId = user.id;
        await new Promise((resolve, reject) => {
          req.session.save((err: any) => {
            if (err) {
              reject(err);
            } else {
              resolve(true);
            }
          });
        });
      }
      
      await storage.addLog('info', 'User logged in', { username }, user.id, username, 'login');
      
      res.json({ 
        success: true, 
        user: { id: user.id, username: user.username } 
      });
    } catch (error) {
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
      if (!req.session?.userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      res.json({ 
        user: { id: user.id, username: user.username } 
      });
    } catch (error) {
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

      const chats = await storage.getUserChats(userId);
      const user = await storage.getUser(userId);
      await storage.addLog('info', 'User fetched chats', { chatCount: chats.length }, userId, user?.username, 'fetch_chats');
      res.json({ chats });
    } catch (error) {
      const user = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      await storage.addLog('error', 'Failed to fetch chats', { error: error instanceof Error ? error.message : 'Unknown error' }, user?.id, user?.username, 'fetch_chats');
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

      const chat = await storage.createChat({ userId, title });
      const user = await storage.getUser(userId);
      await storage.addLog('info', 'User created chat', { chatId: chat.id, title }, userId, user?.username, 'create_chat');
      res.json({ chat });
    } catch (error) {
      const user = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      await storage.addLog('error', 'Failed to create chat', { error: error instanceof Error ? error.message : 'Unknown error', title: req.body.title }, user?.id, user?.username, 'create_chat');
      res.status(500).json({ error: 'Failed to create chat' });
    }
  });

  // Helper function for web search
  const searchWeb = async (query: string) => {
    try {
      await storage.addLog('info', `Searching web for: ${query}`);
      
      const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&skip_disambig=1`;
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ChatBot/1.0)'
        },
        signal: AbortSignal.timeout(10000)
      });
      
      if (!response.ok) {
        throw new Error(`Search API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Extract useful information from DuckDuckGo response
      let searchResults = '';
      
      // Abstract (main answer)
      if (data.Abstract) {
        searchResults += `Hlavní informace: ${data.Abstract}\n\n`;
      }
      
      // Related topics
      if (data.RelatedTopics && data.RelatedTopics.length > 0) {
        searchResults += 'Souvisící témata:\n';
        data.RelatedTopics.slice(0, 3).forEach((topic: any, index: number) => {
          if (topic.Text) {
            searchResults += `${index + 1}. ${topic.Text}\n`;
          }
        });
        searchResults += '\n';
      }
      
      // Infobox data
      if (data.Infobox && data.Infobox.content && data.Infobox.content.length > 0) {
        searchResults += 'Další informace:\n';
        data.Infobox.content.slice(0, 3).forEach((item: any) => {
          if (item.label && item.value) {
            searchResults += `${item.label}: ${item.value}\n`;
          }
        });
      }
      
      await storage.addLog('info', 'Web search completed', { 
        query, 
        hasAbstract: !!data.Abstract,
        topicsCount: data.RelatedTopics?.length || 0
      });
      
      return searchResults || 'Bohužel se nepodařilo najít relevantní informace.';
      
    } catch (error) {
      await storage.addLog('error', 'Web search failed', { 
        query, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return `Omlouvám se, nepodařilo se mi vyhledat informace na webu. Chyba: ${error instanceof Error ? error.message : 'Neznámá chyba'}`;
    }
  };

  // AI Generation endpoint
  app.post('/api/generate', async (req, res) => {
    try {
      const { prompt, model, stream, ngrokUrl, history } = req.body;
      
      if (!prompt) {
        await storage.addLog('error', 'Generate request missing prompt', { body: req.body });
        return res.status(400).json({ error: 'Prompt is required' });
      }

      // Detect if this is a search query
      const searchKeywords = ['najdi', 'vyhledej', 'hledej', 'co se děje', 'aktuální', 'novinky', 'zprávy', 'na webu', 'google', 'search'];
      const isSearchQuery = searchKeywords.some(keyword => 
        prompt.toLowerCase().includes(keyword.toLowerCase())
      );

      let finalPrompt = prompt;
      let searchResults = '';

      // If it's a search query, perform web search first
      if (isSearchQuery) {
        // Extract search terms from the prompt
        const searchQuery = prompt.replace(/najdi|vyhledej|hledej|na webu|google|mi/gi, '').trim();
        searchResults = await searchWeb(searchQuery);
        
        // Modify the prompt to include search results
        finalPrompt = `Uživatel se ptá: "${prompt}"

Zde jsou aktuální informace z webového vyhledávání:
${searchResults}

Na základě těchto informací odpověz uživateli v češtině. Pokud informace nejsou dostatečné, řekni to a pokus se poskytnout obecnou odpověď na základě svých znalostí.`;
      }

      // Create roleplay prompt with conversation history (only if not a search query)
      if (!isSearchQuery && history && Array.isArray(history) && history.length > 0) {
        const historyText = history.map((msg: any) => 
          `${msg.type === 'user' ? 'Human' : 'Assistant'}: ${msg.content}`
        ).join('\n');
        
        finalPrompt = `You are a helpful AI assistant engaged in a roleplay conversation. Below is the recent conversation history for context - don't directly reference or respond to it, just use it as background memory to maintain conversation flow and character consistency.

=== Recent Conversation History ===
${historyText}
=== End of History ===

Now respond to the current message while staying in character and maintaining conversation continuity:

${prompt}`;
      }

      const requestBody = {
        model: model || "llama2:7b",
        prompt: finalPrompt,
        stream: stream || false
      };

      // Get ngrok URL from settings
      const savedNgrokUrl = await storage.getNgrokUrl();
      const targetUrl = ngrokUrl || savedNgrokUrl || 'https://0c8125184293.ngrok-free.app';
      const fullUrl = `${targetUrl}/api/generate`;

      await storage.addLog('info', `AI request to ${fullUrl}`, { 
        originalPrompt: prompt.substring(0, 100),
        historyCount: history?.length || 0,
        model: requestBody.model
      });

      // Make request to ngrok
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000);

      try {
        const response = await fetch(fullUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; ChatBot/1.0)',
            'Accept': 'application/json',
            'ngrok-skip-browser-warning': 'true'
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const errorText = await response.text();
          await storage.addLog('error', `AI service error: ${response.status}`, { 
            url: fullUrl, 
            status: response.status,
            error: errorText.substring(0, 200)
          });
          
          return res.status(500).json({ 
            error: 'AI service error',
            details: `Service responded with ${response.status}`
          });
        }

        const data = await response.json();
        await storage.addLog('info', 'AI request successful', { 
          responseLength: data.response?.length || 0
        });
        
        res.json(data);
        
      } catch (fetchError: unknown) {
        clearTimeout(timeoutId);
        const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
        
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          await storage.addLog('error', 'AI request timeout', { timeout: '5m' });
          return res.status(408).json({
            error: 'AI service timeout'
          });
        }
        
        const isNetworkError = errorMessage.includes('ENOTFOUND') || 
                             errorMessage.includes('ECONNREFUSED') || 
                             errorMessage.includes('ETIMEDOUT') ||
                             errorMessage.includes('fetch failed');
        
        if (isNetworkError) {
          await storage.addLog('error', 'Network error - cannot reach AI service', { 
            error: errorMessage
          });
          
          return res.status(503).json({
            error: 'Network connectivity issue'
          });
        }
        
        throw fetchError;
      }
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      await storage.addLog('error', 'Generate endpoint error', { 
        error: errorMessage
      });
      
      res.status(500).json({ 
        error: 'Failed to process AI request'
      });
    }
  });

  // Settings endpoints
  app.get('/api/settings/ngrok-url', async (req, res) => {
    try {
      const setting = await storage.getSettingByKey('ngrok_url');
      const ngrokUrl = setting?.value || 'https://0c8125184293.ngrok-free.app';
      res.json({ ngrokUrl });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch ngrok URL' });
    }
  });

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
      const user = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      await storage.addLog('error', 'Failed to save ngrok URL', { error: error instanceof Error ? error.message : 'Unknown error' }, user?.id, user?.username, 'change_ngrok_url');
      res.status(500).json({ error: 'Failed to save ngrok URL' });
    }
  });

  // Chat message endpoints
  app.get('/api/chats/:chatId/messages', async (req, res) => {
    try {
      const userId = req.session?.userId;
      const { chatId } = req.params;
      
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      const messages = await storage.getChatMessages(chatId);
      res.json({ messages });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  app.post('/api/chats/:chatId/messages', async (req, res) => {
    try {
      const userId = req.session?.userId;
      const { chatId } = req.params;
      const { content, type } = req.body;
      
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!content || !type) {
        return res.status(400).json({ error: 'Content and type required' });
      }

      const message = await storage.createMessage({ chatId, content, type });
      res.json({ message });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create message' });
    }
  });

  // Chat management endpoints  
  app.put('/api/chats/:chatId', async (req, res) => {
    try {
      const userId = req.session?.userId;
      const { chatId } = req.params;
      const { title } = req.body;
      
      if (!userId) {
        return res.status(401).json({ error: 'Not authenticated' });
      }

      if (!title) {
        return res.status(400).json({ error: 'Title required' });
      }

      const chat = await storage.updateChat(chatId, title);
      res.json({ chat });
    } catch (error) {
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

      await storage.deleteChat(chatId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete chat' });
    }
  });

  // Admin endpoints
  app.get('/api/admin/ai-model', async (req, res) => {
    try {
      const setting = await storage.getSettingByKey('ai_model');
      const aiModel = setting?.value || 'llama2:7b';
      res.json({ aiModel });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch AI model' });
    }
  });

  app.post('/api/admin/ai-model', async (req, res) => {
    try {
      const { aiModel } = req.body;
      
      if (!aiModel || typeof aiModel !== 'string') {
        return res.status(400).json({ error: 'AI model is required' });
      }

      await storage.upsertSetting('ai_model', aiModel);
      res.json({ success: true, aiModel });
    } catch (error) {
      res.status(500).json({ error: 'Failed to save AI model' });
    }
  });

  // Logging endpoints (development only)
  app.get('/api/logs', async (req, res) => {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    try {
      const logs = await storage.getLogs(50);
      res.json({ logs });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  app.get('/api/errors', async (req, res) => {
    if (process.env.NODE_ENV !== 'development') {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    try {
      const errors = await storage.getErrors(50);
      res.json({ errors });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch errors' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}