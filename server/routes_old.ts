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

// CAPTCHA verification function
async function verifyCaptcha(token: string): Promise<boolean> {
  if (!token) return false;
  
  // For development, allow test token
  if (process.env.NODE_ENV === 'development' && token === 'test-token') {
    return true;
  }
  
  try {
    const secretKey = process.env.RECAPTCHA_SECRET_KEY;
    if (!secretKey) {
      console.warn('RECAPTCHA_SECRET_KEY not configured, skipping verification');
      return process.env.NODE_ENV === 'development'; // Allow in dev, block in prod
    }
    
    const response = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
      params: {
        secret: secretKey,
        response: token
      }
    });
    
    return response.data.success === true;
  } catch (error) {
    console.error('CAPTCHA verification error:', error);
    return false;
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
  app.get('/api/test', async (req, res) => {
    console.log('Adding test log...');
    await storage.addLog('info', 'Test endpoint accessed', { timestamp: new Date().toISOString() });
    console.log('Test log added successfully');
    res.json({ 
      message: 'Backend is working!', 
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV 
    });
  });

  // Add test data endpoint for debugging
  app.post('/api/test/add-logs', async (req, res) => {
    try {
      // Add some test logs
      await storage.addLog('info', 'Uživatel se přihlásil', { username: 'testuser' });
      await storage.addLog('info', 'Chat byl vytvořen', { chatId: 'test-123', title: 'Test Chat' });
      await storage.addLog('warn', 'Pomalé připojení k AI serveru', { responseTime: 5000 });
      await storage.addLog('error', 'Chyba při připojení k ngrok', { error: 'Connection timeout', url: 'https://test.ngrok.io' });
      await storage.addLog('info', 'AI odpověď úspěšně doručena', { tokens: 150, model: 'llama2:7b' });
      
      res.json({ 
        message: 'Test logs added successfully!',
        count: 5
      });
    } catch (error) {
      console.error('Error adding test logs:', error);
      res.status(500).json({ error: 'Failed to add test logs' });
    }
  });

  // Railway network debugging endpoint
  app.post('/api/debug/network', async (req, res) => {
    const { testUrl } = req.body;
    const targetUrl = testUrl || 'https://0c8125184293.ngrok-free.app';
    
    try {
      console.log('=== NETWORK DEBUG TEST ===');
      console.log('Testing URL:', targetUrl);
      console.log('Platform:', process.env.RAILWAY_ENVIRONMENT ? 'Railway' : 'Replit');
      console.log('Node version:', process.version);
      
      await storage.addLog('info', 'Starting network debug test', { 
        targetUrl,
        platform: process.env.RAILWAY_ENVIRONMENT ? 'railway' : 'replit' 
      });

      // Test basic connectivity
      const testResponse = await fetch(targetUrl, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ReplichatBot/1.0)',
          'ngrok-skip-browser-warning': 'true'
        },
        signal: AbortSignal.timeout(10000)
      });

      console.log('Head request response:', testResponse.status, testResponse.statusText);

      // Test full POST request
      const fullTest = await fetch(`${targetUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; ReplichatBot/1.0)',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({
          model: 'llama2:7b',
          prompt: 'debug test from Railway',
          stream: false
        }),
        signal: AbortSignal.timeout(15000)
      });

      console.log('Full POST test response:', fullTest.status, fullTest.statusText);
      
      await storage.addLog('info', 'Network debug test completed', { 
        headStatus: testResponse.status,
        postStatus: fullTest.status,
        success: true
      });

      res.json({
        success: true,
        results: {
          headTest: {
            status: testResponse.status,
            statusText: testResponse.statusText,
            headers: JSON.stringify(Array.from(testResponse.headers.entries()))
          },
          postTest: {
            status: fullTest.status,
            statusText: fullTest.statusText,
            contentType: fullTest.headers.get('content-type')
          }
        },
        platform: process.env.RAILWAY_ENVIRONMENT ? 'railway' : 'replit',
        targetUrl
      });
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('=== NETWORK DEBUG ERROR ===');
      console.error('Error:', errorMessage);
      console.error('Error type:', error instanceof Error ? error.constructor.name : typeof error);
      
      await storage.addLog('error', 'Network debug test failed', { 
        error: errorMessage,
        targetUrl,
        platform: process.env.RAILWAY_ENVIRONMENT ? 'railway' : 'replit'
      });

      res.status(500).json({
        success: false,
        error: errorMessage,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        platform: process.env.RAILWAY_ENVIRONMENT ? 'railway' : 'replit',
        targetUrl,
        suggestion: 'Network connectivity issue - Railway may be blocking outbound connections'
      });
    }
  });

  // Roleplay bot endpoint with conversation history
  app.post('/api/generate', async (req, res) => {
    try {
      const { prompt, model, stream, ngrokUrl, history } = req.body;
      
      if (!prompt) {
        await storage.addLog('error', 'Generate request missing prompt', { body: req.body });
        return res.status(400).json({ error: 'Prompt is required' });
      }

      // Create roleplay prompt with conversation history
      let finalPrompt = prompt;
      if (history && Array.isArray(history) && history.length > 0) {
        const historyText = history.map((msg: any) => 
          `${msg.type === 'user' ? 'Human' : 'Assistant'}: ${msg.content}`
        ).join('\n');
        
        finalPrompt = `You are a helpful AI assistant engaged in a roleplay conversation. Below is the recent conversation history for context - don't directly reference or respond to it, just use it as background memory to maintain conversation flow and character consistency.

=== Recent Conversation History ===
${historyText}
=== End of History ===

Now respond to the current message while staying in character and maintaining conversation continuity:

${prompt}`;
        
        console.log('Roleplay prompt created with', history.length, 'history messages');
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

      console.log('=== ROLEPLAY GENERATE REQUEST ===');
      console.log('Original prompt:', prompt.substring(0, 100));
      console.log('History messages:', history?.length || 0);
      console.log('Target URL:', fullUrl);
      console.log('==================================');

      await storage.addLog('info', `Roleplay AI request to ${fullUrl}`, { 
        originalPrompt: prompt.substring(0, 100),
        historyCount: history?.length || 0,
        model: requestBody.model
      });

      // Make request to ngrok
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(fullUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; RoleplayBot/1.0)',
            'Accept': 'application/json',
            'ngrok-skip-browser-warning': 'true'
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        console.log(`Ngrok response: ${response.status} ${response.statusText}`);
        
        if (!response.ok) {
          const errorText = await response.text();
          await storage.addLog('error', `Ngrok error: ${response.status}`, { 
            url: fullUrl, 
            status: response.status,
            error: errorText.substring(0, 200)
          });
          
          return res.status(500).json({ 
            error: 'AI service error',
            details: `Ngrok responded with ${response.status}`,
            status: response.status
          });
        }

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await response.text();
          await storage.addLog('error', 'Non-JSON response from ngrok', { 
            contentType: contentType,
            preview: text.substring(0, 200) 
          });
          
          return res.status(500).json({
            error: 'Invalid response from AI service',
            details: 'Expected JSON response'
          });
        }

        const data = await response.json();
        await storage.addLog('info', 'Roleplay AI request successful', { 
          responseLength: data.response?.length || 0
        });
        
        res.json(data);
        
      } catch (fetchError: unknown) {
        clearTimeout(timeoutId);
        
        const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
        
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          await storage.addLog('error', 'AI request timeout', { timeout: '30s' });
          return res.status(408).json({
            error: 'AI service timeout',
            details: 'Request timed out after 30 seconds'
          });
        }
        
        // Network error handling
        const isNetworkError = errorMessage.includes('ENOTFOUND') || 
                             errorMessage.includes('ECONNREFUSED') || 
                             errorMessage.includes('ETIMEDOUT') ||
                             errorMessage.includes('fetch failed');
        
        if (isNetworkError) {
          await storage.addLog('error', 'Network error - cannot reach ngrok', { 
            error: errorMessage,
            platform: process.env.RAILWAY_ENVIRONMENT ? 'railway' : 'replit'
          });
          
          return res.status(503).json({
            error: 'Network connectivity issue',
            details: 'Cannot reach AI service',
            isNetworkError: true
          });
        }
        
        throw fetchError;
      }
      
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Generate endpoint error:', errorMessage);
      
      await storage.addLog('error', 'Generate endpoint error', { 
        error: errorMessage,
        platform: process.env.RAILWAY_ENVIRONMENT ? 'railway' : 'replit'
      });
      
      res.status(500).json({ 
        error: 'Failed to process AI request',
        details: errorMessage
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


  // Auth endpoints
  app.post('/api/auth/register', async (req, res) => {
    try {
      
      
      const { username, password, captchaToken } = req.body;
      
      if (!username || !password) {
        console.log('Missing username or password');
        return res.status(400).json({ error: 'Username and password required' });
      }

      // Verify CAPTCHA
      const captchaValid = await verifyCaptcha(captchaToken);
      if (!captchaValid) {
        console.log('Invalid CAPTCHA token');
        return res.status(400).json({ error: 'CAPTCHA verification failed' });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        console.log('User already exists:', username);
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
              console.error('Registration session save error:', err);
              reject(err);
            } else {
              ', user.id);
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
      
      
      const { username, password, captchaToken } = req.body;
      
      if (!username || !password) {
        console.log('Missing username or password');
        return res.status(400).json({ error: 'Username and password required' });
      }

      // Verify CAPTCHA
      const captchaValid = await verifyCaptcha(captchaToken);
      if (!captchaValid) {
        console.log('Invalid CAPTCHA token');
        return res.status(400).json({ error: 'CAPTCHA verification failed' });
      }

      const user = await storage.getUserByUsername(username);
      if (!user) {
        console.log('User not found:', username);
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Verify password using bcrypt
      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) {
        console.log('Invalid password for user:', username);
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
              ', user.id);
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
      ', { 
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
      ', { 
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

  // Admin AI model endpoints
  app.get('/api/admin/ai-model', async (req, res) => {
    try {
      const aiModel = await storage.getAiModel();
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

      await storage.setAiModel(aiModel);
      const user = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      await storage.addLog('info', 'AI model changed', { newModel: aiModel }, user?.id, user?.username, 'change_ai_model');
      
      res.json({ aiModel });
    } catch (error) {
      console.error('Error saving AI model:', error);
      const user = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      await storage.addLog('error', 'Failed to save AI model', { error: error instanceof Error ? error.message : 'Unknown error' }, user?.id, user?.username, 'change_ai_model');
      res.status(500).json({ error: 'Failed to save AI model' });
    }
  });

  // Logs and errors endpoints for admin panel
  app.get('/api/logs', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      ', !!req.session);
      const logs = await storage.getLogs(limit);
      console.log('Found logs:', logs.length);
      res.json({ logs });
    } catch (error) {
      console.error('Error fetching logs:', error);
      await storage.addLog('error', 'Failed to fetch logs', { error: error instanceof Error ? error.message : 'Unknown error' });
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  app.get('/api/errors', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const errors = await storage.getErrors(limit);
      res.json({ errors });
    } catch (error) {
      console.error('Error fetching errors:', error);
      await storage.addLog('error', 'Failed to fetch errors', { error: error instanceof Error ? error.message : 'Unknown error' });
      res.status(500).json({ error: 'Failed to fetch errors' });
    }
  });

  // use storage to perform CRUD operations on the storage interface
  // e.g. storage.insertUser(user) or storage.getUserByUsername(username)

  const httpServer = createServer(app);

  return httpServer;
}
