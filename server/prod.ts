import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

// Serve static files (built frontend)
const staticPath = path.resolve(__dirname, '..', 'dist', 'public');
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