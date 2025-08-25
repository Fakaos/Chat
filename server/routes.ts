import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

export async function registerRoutes(app: Express): Promise<Server> {
  // put application routes here
  // prefix all routes with /api

  // Local API endpoint to simulate Llama chat
  app.post('/api/generate', (req, res) => {
    const { prompt, model } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Simulate AI response with some delay
    setTimeout(() => {
      const responses = [
        `Děkuji za vaši zprávu: "${prompt}". Jsem AI asistent a rád vám pomohu s jakýmkoliv dotazem!`,
        `To je zajímavý dotaz ohledně "${prompt}". Rád bych vám pomohl najít řešení.`,
        `Chápu vaši otázku o "${prompt}". Zde je moje odpověď a doporučení pro vás.`,
        `Ohledně "${prompt}" - to je téma, které má několik aspektů. Pojďme si to projít společně.`,
        `Vaše zpráva "${prompt}" je velmi zajímavá. Rád vám poskytnu podrobné informace.`
      ];
      
      const randomResponse = responses[Math.floor(Math.random() * responses.length)];
      
      res.json({
        response: randomResponse,
        model: model || "llama2:7b",
        timestamp: new Date().toISOString()
      });
    }, 1000 + Math.random() * 2000); // Random delay 1-3 seconds
  });

  // use storage to perform CRUD operations on the storage interface
  // e.g. storage.insertUser(user) or storage.getUserByUsername(username)

  const httpServer = createServer(app);

  return httpServer;
}
