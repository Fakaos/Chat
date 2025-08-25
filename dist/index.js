// server/index.ts
import express2 from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

// server/routes.ts
import { createServer } from "http";

// shared/schema.ts
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
var users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  createdAt: timestamp("created_at").defaultNow()
});
var chats = pgTable("chats", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow()
});
var messages = pgTable("messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  chatId: varchar("chat_id").references(() => chats.id).notNull(),
  type: text("type").notNull(),
  // 'user' | 'ai'
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow()
});
var settings = pgTable("settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: text("value").notNull()
});
var insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true
});
var insertChatSchema = createInsertSchema(chats).pick({
  userId: true,
  title: true
});
var insertMessageSchema = createInsertSchema(messages).pick({
  chatId: true,
  type: true,
  content: true
});
var insertSettingSchema = createInsertSchema(settings).pick({
  key: true,
  value: true
});

// server/storage.ts
import { randomUUID } from "crypto";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
import { eq, desc } from "drizzle-orm";
var { Pool } = pkg;
var MemStorage = class {
  users;
  settings;
  chats;
  messages;
  logs = [];
  constructor() {
    this.users = /* @__PURE__ */ new Map();
    this.settings = /* @__PURE__ */ new Map();
    this.chats = /* @__PURE__ */ new Map();
    this.messages = /* @__PURE__ */ new Map();
  }
  async getUser(id) {
    return this.users.get(id);
  }
  async getUserByUsername(username) {
    return Array.from(this.users.values()).find(
      (user) => user.username === username
    );
  }
  async createUser(insertUser) {
    const id = randomUUID();
    const user = { ...insertUser, id, createdAt: /* @__PURE__ */ new Date() };
    this.users.set(id, user);
    return user;
  }
  async getSettingByKey(key) {
    return this.settings.get(key);
  }
  async upsertSetting(key, value) {
    const existing = this.settings.get(key);
    if (existing) {
      const updated = { ...existing, value };
      this.settings.set(key, updated);
      return updated;
    } else {
      const id = randomUUID();
      const setting = { id, key, value };
      this.settings.set(key, setting);
      return setting;
    }
  }
  async addLog(level, message, data) {
    const logEntry = {
      id: randomUUID(),
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      message,
      data
    };
    this.logs.push(logEntry);
    if (this.logs.length > 1e3) {
      this.logs = this.logs.slice(-1e3);
    }
  }
  async getLogs(limit = 50) {
    return this.logs.slice(-limit).reverse();
  }
  async getErrors(limit = 50) {
    return this.logs.filter((log2) => log2.level === "error").slice(-limit).reverse();
  }
  async getNgrokUrl() {
    const setting = await this.getSettingByKey("ngrok_url");
    return setting?.value;
  }
  async setNgrokUrl(url) {
    await this.upsertSetting("ngrok_url", url);
  }
  // Chat methods
  async getUserChats(userId) {
    return Array.from(this.chats.values()).filter((chat) => chat.userId === userId).sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
  }
  async createChat(insertChat) {
    const id = randomUUID();
    const now = /* @__PURE__ */ new Date();
    const chat = {
      id,
      userId: insertChat.userId || null,
      title: insertChat.title,
      createdAt: now,
      updatedAt: now
    };
    this.chats.set(id, chat);
    return chat;
  }
  async updateChat(chatId, title) {
    const chat = this.chats.get(chatId);
    if (chat) {
      const updated = { ...chat, title, updatedAt: /* @__PURE__ */ new Date() };
      this.chats.set(chatId, updated);
      return updated;
    }
    return void 0;
  }
  async deleteChat(chatId) {
    Array.from(this.messages.keys()).forEach((messageId) => {
      const message = this.messages.get(messageId);
      if (message?.chatId === chatId) {
        this.messages.delete(messageId);
      }
    });
    return this.chats.delete(chatId);
  }
  // Message methods
  async getChatMessages(chatId) {
    return Array.from(this.messages.values()).filter((message) => message.chatId === chatId).sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  }
  async createMessage(insertMessage) {
    const id = randomUUID();
    const message = {
      ...insertMessage,
      id,
      createdAt: /* @__PURE__ */ new Date()
    };
    this.messages.set(id, message);
    const chat = this.chats.get(insertMessage.chatId);
    if (chat) {
      const updated = { ...chat, updatedAt: /* @__PURE__ */ new Date() };
      this.chats.set(insertMessage.chatId, updated);
    }
    return message;
  }
};
var DatabaseStorage = class {
  db;
  logs = [];
  // Keep logs in memory for now
  constructor(databaseUrl) {
    if (!databaseUrl) {
      throw new Error("Database URL is required for DatabaseStorage");
    }
    if (process.env.NODE_ENV === "production" || databaseUrl.includes("railway")) {
      console.log("Using standard PostgreSQL client for Railway");
      const pool = new Pool({
        connectionString: databaseUrl,
        ssl: databaseUrl.includes("railway") ? { rejectUnauthorized: false } : false
      });
      this.db = pgDrizzle(pool);
      this.initializeTables();
    } else {
      console.log("Using Neon client for development");
      const sql2 = neon(databaseUrl);
      this.db = drizzle(sql2);
      if (databaseUrl && !databaseUrl.includes("neon")) {
        this.initializeTables();
      }
    }
  }
  async getUser(id) {
    const result = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }
  async getUserByUsername(username) {
    const result = await this.db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }
  async createUser(insertUser) {
    const result = await this.db.insert(users).values(insertUser).returning();
    return result[0];
  }
  async getSettingByKey(key) {
    const result = await this.db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return result[0];
  }
  async upsertSetting(key, value) {
    const existing = await this.getSettingByKey(key);
    if (existing) {
      const result = await this.db.update(settings).set({ value }).where(eq(settings.key, key)).returning();
      return result[0];
    } else {
      const result = await this.db.insert(settings).values({ key, value }).returning();
      return result[0];
    }
  }
  async addLog(level, message, data) {
    const logEntry = {
      id: randomUUID(),
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      message,
      data
    };
    this.logs.push(logEntry);
    if (this.logs.length > 1e3) {
      this.logs = this.logs.slice(-1e3);
    }
  }
  async getLogs(limit = 50) {
    return this.logs.slice(-limit).reverse();
  }
  async getErrors(limit = 50) {
    return this.logs.filter((log2) => log2.level === "error").slice(-limit).reverse();
  }
  async getUserChats(userId) {
    const result = await this.db.select().from(chats).where(eq(chats.userId, userId)).orderBy(desc(chats.updatedAt));
    return result;
  }
  async createChat(insertChat) {
    const result = await this.db.insert(chats).values(insertChat).returning();
    return result[0];
  }
  async updateChat(chatId, title) {
    const result = await this.db.update(chats).set({ title, updatedAt: /* @__PURE__ */ new Date() }).where(eq(chats.id, chatId)).returning();
    return result[0];
  }
  async deleteChat(chatId) {
    await this.db.delete(messages).where(eq(messages.chatId, chatId));
    const result = await this.db.delete(chats).where(eq(chats.id, chatId));
    return true;
  }
  async getChatMessages(chatId) {
    const result = await this.db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(messages.createdAt);
    return result;
  }
  async createMessage(insertMessage) {
    const result = await this.db.insert(messages).values(insertMessage).returning();
    await this.db.update(chats).set({ updatedAt: /* @__PURE__ */ new Date() }).where(eq(chats.id, insertMessage.chatId));
    return result[0];
  }
  async getNgrokUrl() {
    const setting = await this.getSettingByKey("ngrok_url");
    return setting?.value;
  }
  async setNgrokUrl(url) {
    await this.upsertSetting("ngrok_url", url);
  }
  initializeTables() {
    this.doInitializeTables().catch(console.error);
  }
  async doInitializeTables() {
    try {
      console.log("Checking database tables...");
      const pool = this.db._.session.client;
      const result = await pool.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name IN ('users', 'chats', 'messages', 'settings')
      `);
      if (result.rows.length >= 4) {
        console.log("All required tables exist, skipping initialization");
        return;
      }
      console.log("Some tables missing, checking what we have:", result.rows.map((r) => r.table_name));
      console.log("Tables already exist in database, using existing schema");
    } catch (error) {
      console.error("Error checking tables:", error);
    }
  }
};
var storage = process.env.DATABASE_URL ? new DatabaseStorage(process.env.DATABASE_URL) : new MemStorage();

// server/routes.ts
async function registerRoutes(app2) {
  app2.use("/api", (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    } else {
      res.header("Access-Control-Allow-Origin", "http://localhost:5000");
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, Cookie");
    res.header("Access-Control-Allow-Credentials", "true");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
  app2.get("/api/test", (req, res) => {
    res.json({
      message: "Backend is working!",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      env: process.env.NODE_ENV
    });
  });
  app2.post("/api/generate", async (req, res) => {
    try {
      const { prompt, model, stream, ngrokUrl } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }
      const requestBody = {
        model: model || "llama2:7b",
        prompt,
        stream: stream || false
      };
      const targetUrl = ngrokUrl || "https://0c8125184293.ngrok-free.app";
      const fullUrl = `${targetUrl}/api/generate`;
      await storage.addLog("info", `AI request to ${fullUrl}`, { prompt: prompt.substring(0, 100) });
      console.log("JSON pos\xEDlan\xFD na ngrok:", JSON.stringify(requestBody, null, 2));
      console.log("Target URL:", fullUrl);
      const response = await fetch(fullUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "ReplichatBot/1.0"
        },
        body: JSON.stringify(requestBody)
      });
      console.log(`Ngrok response status: ${response.status} ${response.statusText}`);
      if (!response.ok) {
        const errorText = await response.text();
        console.log("Ngrok error response:", errorText.substring(0, 200));
        await storage.addLog("error", `Ngrok API error: ${response.status}`, { url: fullUrl, error: errorText.substring(0, 200) });
        throw new Error(`Ngrok API error: ${response.status} ${response.statusText}`);
      }
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text2 = await response.text();
        console.log("Non-JSON response from ngrok:", text2.substring(0, 200));
        await storage.addLog("error", "Ngrok returned non-JSON response", { url: fullUrl, response: text2.substring(0, 200) });
        throw new Error("Ngrok endpoint returned non-JSON response (probably HTML error page)");
      }
      const data = await response.json();
      await storage.addLog("info", "AI request successful", { responseLength: JSON.stringify(data).length });
      res.json(data);
    } catch (error) {
      console.error("Proxy error:", error);
      await storage.addLog("error", "Proxy error in /api/generate", { error: error instanceof Error ? error.message : "Unknown error" });
      res.status(500).json({
        error: "Failed to connect to AI service",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
  app2.get("/api/settings/ngrok-url", async (req, res) => {
    try {
      const setting = await storage.getSettingByKey("ngrok_url");
      const ngrokUrl = setting?.value || "https://0c8125184293.ngrok-free.app";
      res.json({ ngrokUrl });
    } catch (error) {
      console.error("Error fetching ngrok URL:", error);
      res.status(500).json({ error: "Failed to fetch ngrok URL" });
    }
  });
  app2.post("/api/settings/ngrok-url", async (req, res) => {
    try {
      const { ngrokUrl } = req.body;
      if (!ngrokUrl || typeof ngrokUrl !== "string") {
        return res.status(400).json({ error: "Invalid ngrok URL" });
      }
      await storage.upsertSetting("ngrok_url", ngrokUrl);
      await storage.addLog("info", "Ngrok URL changed", { newUrl: ngrokUrl });
      res.json({ success: true, ngrokUrl });
    } catch (error) {
      console.error("Error saving ngrok URL:", error);
      await storage.addLog("error", "Failed to save ngrok URL", { error: error instanceof Error ? error.message : "Unknown error" });
      res.status(500).json({ error: "Failed to save ngrok URL" });
    }
  });
  app2.get("/api/logs", async (req, res) => {
    try {
      console.log("Fetching logs, session:", !!req.session);
      const limit = parseInt(req.query.limit) || 50;
      const logs = await storage.getLogs(limit);
      console.log("Found logs:", logs.length);
      res.json({ logs });
    } catch (error) {
      console.error("Error fetching logs:", error);
      res.status(500).json({ error: "Failed to fetch logs" });
    }
  });
  app2.get("/api/errors", async (req, res) => {
    try {
      console.log("Fetching errors, session:", !!req.session);
      const limit = parseInt(req.query.limit) || 50;
      const errors = await storage.getErrors(limit);
      console.log("Found errors:", errors.length);
      res.json({ errors });
    } catch (error) {
      console.error("Error fetching errors:", error);
      res.status(500).json({ error: "Failed to fetch errors" });
    }
  });
  app2.post("/api/auth/register", async (req, res) => {
    try {
      console.log("Registration attempt:", { body: req.body, hasSession: !!req.session });
      const { username, password } = req.body;
      if (!username || !password) {
        console.log("Missing username or password");
        return res.status(400).json({ error: "Username and password required" });
      }
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        console.log("User already exists:", username);
        return res.status(400).json({ error: "Username already exists" });
      }
      const user = await storage.createUser({ username, password });
      await storage.addLog("info", "User registered", { username });
      if (req.session) {
        req.session.userId = user.id;
        await new Promise((resolve, reject) => {
          req.session.save((err) => {
            if (err) {
              console.error("Registration session save error:", err);
              reject(err);
            } else {
              console.log("Registration session saved for user:", user.id);
              resolve(true);
            }
          });
        });
      } else {
        console.log("No session available");
      }
      res.json({
        success: true,
        user: { id: user.id, username: user.username }
      });
    } catch (error) {
      console.error("Registration error:", error);
      await storage.addLog("error", "Registration failed", { error: error instanceof Error ? error.message : "Unknown error" });
      res.status(500).json({ error: "Registration failed" });
    }
  });
  app2.post("/api/auth/login", async (req, res) => {
    try {
      console.log("Login attempt:", { body: req.body, hasSession: !!req.session });
      const { username, password } = req.body;
      if (!username || !password) {
        console.log("Missing username or password");
        return res.status(400).json({ error: "Username and password required" });
      }
      const user = await storage.getUserByUsername(username);
      if (!user || user.password !== password) {
        console.log("Invalid credentials for user:", username);
        return res.status(401).json({ error: "Invalid credentials" });
      }
      if (req.session) {
        req.session.userId = user.id;
        await new Promise((resolve, reject) => {
          req.session.save((err) => {
            if (err) {
              console.error("Login session save error:", err);
              reject(err);
            } else {
              console.log("Login session saved for user:", user.id);
              resolve(true);
            }
          });
        });
      } else {
        console.log("No session available");
      }
      await storage.addLog("info", "User logged in", { username });
      res.json({
        success: true,
        user: { id: user.id, username: user.username }
      });
    } catch (error) {
      console.error("Login error:", error);
      await storage.addLog("error", "Login failed", { error: error instanceof Error ? error.message : "Unknown error" });
      res.status(500).json({ error: "Login failed" });
    }
  });
  app2.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ success: true });
    });
  });
  app2.get("/api/auth/me", async (req, res) => {
    try {
      console.log("Auth check:", {
        hasSession: !!req.session,
        sessionUserId: req.session?.userId,
        sessionId: req.session?.id,
        cookies: req.headers.cookie,
        sessionData: req.session
      });
      if (!req.session) {
        console.log("No session object");
        return res.status(401).json({ error: "Not authenticated" });
      }
      const userId = req.session.userId;
      if (!userId) {
        console.log("No userId in session, regenerating session");
        return res.status(401).json({ error: "Not authenticated" });
      }
      const user = await storage.getUser(userId);
      if (!user) {
        console.log("User not found:", userId);
        return res.status(401).json({ error: "User not found" });
      }
      console.log("Auth successful for user:", user.id);
      res.json({
        user: { id: user.id, username: user.username }
      });
    } catch (error) {
      console.error("Auth check error:", error);
      res.status(500).json({ error: "Auth check failed" });
    }
  });
  app2.get("/api/chats", async (req, res) => {
    try {
      console.log("Fetching chats for session:", {
        hasSession: !!req.session,
        sessionUserId: req.session?.userId,
        cookies: req.headers.cookie?.substring(0, 100)
      });
      const userId = req.session?.userId;
      if (!userId) {
        console.log("Chats request - no userId in session");
        return res.status(401).json({ error: "Not authenticated" });
      }
      const chats2 = await storage.getUserChats(userId);
      console.log(`Found ${chats2.length} chats for user ${userId}`);
      res.json({ chats: chats2 });
    } catch (error) {
      console.error("Error fetching chats:", error);
      res.status(500).json({ error: "Failed to fetch chats" });
    }
  });
  app2.post("/api/chats", async (req, res) => {
    try {
      console.log("Creating chat for session:", {
        hasSession: !!req.session,
        sessionUserId: req.session?.userId,
        body: req.body,
        cookies: req.headers.cookie?.substring(0, 100)
      });
      const userId = req.session?.userId;
      const { title } = req.body;
      if (!userId) {
        console.log("Chat creation - no userId in session");
        return res.status(401).json({ error: "Not authenticated" });
      }
      const chat = await storage.createChat({ userId, title });
      console.log("Chat created successfully:", chat.id);
      res.json({ chat });
    } catch (error) {
      console.error("Error creating chat:", error);
      res.status(500).json({ error: "Failed to create chat" });
    }
  });
  app2.get("/api/chats/:chatId/messages", async (req, res) => {
    try {
      const userId = req.session.userId;
      const { chatId } = req.params;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const messages2 = await storage.getChatMessages(chatId);
      res.json({ messages: messages2 });
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });
  app2.post("/api/chats/:chatId/messages", async (req, res) => {
    try {
      const userId = req.session.userId;
      const { chatId } = req.params;
      const { type, content } = req.body;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const message = await storage.createMessage({ chatId, type, content });
      res.json({ message });
    } catch (error) {
      console.error("Error creating message:", error);
      res.status(500).json({ error: "Failed to create message" });
    }
  });
  app2.put("/api/chats/:chatId", async (req, res) => {
    try {
      const userId = req.session.userId;
      const { chatId } = req.params;
      const { title } = req.body;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const chat = await storage.updateChat(chatId, title);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      res.json({ chat });
    } catch (error) {
      console.error("Error updating chat:", error);
      res.status(500).json({ error: "Failed to update chat" });
    }
  });
  app2.delete("/api/chats/:chatId", async (req, res) => {
    try {
      const userId = req.session.userId;
      const { chatId } = req.params;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const deleted = await storage.deleteChat(chatId);
      res.json({ success: deleted });
    } catch (error) {
      console.error("Error deleting chat:", error);
      res.status(500).json({ error: "Failed to delete chat" });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}

// server/vite.ts
import express from "express";
import fs from "fs";
import path2 from "path";
import { createServer as createViteServer, createLogger } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
var vite_config_default = defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...process.env.NODE_ENV !== "production" && process.env.REPL_ID !== void 0 ? [
      await import("@replit/vite-plugin-cartographer").then(
        (m) => m.cartographer()
      )
    ] : []
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/vite.ts
import { nanoid } from "nanoid";
var viteLogger = createLogger();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app2) {
  const distPath = path2.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/index.ts
var app = express2();
app.set("trust proxy", 1);
app.use(express2.json());
app.use(express2.urlencoded({ extended: false }));
var sessionConfig = {
  secret: process.env.SESSION_SECRET || "chat-app-secret-key-change-in-production",
  resave: false,
  saveUninitialized: true,
  // Change to true to ensure session gets created
  cookie: {
    secure: false,
    // Railway uses reverse proxy, keep false
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1e3,
    // 24 hours
    sameSite: "lax",
    path: "/"
    // Explicitly set path
  },
  name: "sessionId"
};
if (process.env.DATABASE_URL) {
  const PgSession = connectPgSimple(session);
  sessionConfig.store = new PgSession({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true
  });
  console.log("Using PostgreSQL session store");
} else {
  console.log("DATABASE_URL not found, using default MemoryStore for sessions");
}
app.use(session(sessionConfig));
app.use((req, res, next) => {
  const start = Date.now();
  const path3 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path3.startsWith("/api")) {
      let logLine = `${req.method} ${path3} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
(async () => {
  const server = await registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true
  }, () => {
    log(`serving on port ${port}`);
  });
})();
