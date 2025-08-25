import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

export async function registerRoutes(app: Express): Promise<Server> {
  // put application routes here
  // prefix all routes with /api

  // Proxy endpoint for ngrok communication
  app.post('/api/generate', async (req, res) => {
    try {
      const { prompt, model, stream } = req.body;
      
      if (!prompt) {
        return res.status(400).json({ error: 'Prompt is required' });
      }

      // Forward request to ngrok endpoint
      const response = await fetch('https://0c8125184293.ngrok-free.app/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ReplichatBot/1.0'
        },
        body: JSON.stringify({
          model: model || "llama2:7b",
          prompt: prompt,
          stream: stream || false
        })
      });

      if (!response.ok) {
        throw new Error(`Ngrok API error: ${response.status} ${response.statusText}`);
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
