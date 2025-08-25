import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

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
      const { prompt, model, stream, history } = req.body;
      
      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
      }

      // Sestavit kontext z historie
      let contextualPrompt = prompt;
      if (history && history.length > 0) {
        const contextMessages = history.map((msg: any) => {
          const role = msg.type === 'user' ? 'Uživatel' : 'AI';
          return `${role}: ${msg.content}`;
        }).join('\n');
        
        contextualPrompt = `${contextMessages}
Uživatel: ${prompt}
AI:`;
      }

      const requestBody = {
        model: model || "llama2:7b",
        prompt: contextualPrompt,
        stream: stream || false
      };

      console.log('JSON posílaný na ngrok:', JSON.stringify(requestBody, null, 2));

      // Forward request to ngrok endpoint
      const response = await fetch('https://0c8125184293.ngrok-free.app/api/generate', {
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

  // use storage to perform CRUD operations on the storage interface
  // e.g. storage.insertUser(user) or storage.getUserByUsername(username)

  const httpServer = createServer(app);

  return httpServer;
}
