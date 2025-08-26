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
  async addLog(level, message, data, userId, username, action) {
    const logEntry = {
      id: randomUUID(),
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      message,
      userId,
      username,
      action,
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
    return this.logs.filter((log2) => log2.level === "error" && !log2.message.toLowerCase().includes("invalid credentials") && !log2.message.toLowerCase().includes("login failed")).slice(-limit).reverse();
  }
  async getNgrokUrl() {
    const setting = await this.getSettingByKey("ngrok_url");
    return setting?.value;
  }
  async setNgrokUrl(url) {
    await this.upsertSetting("ngrok_url", url);
  }
  async getAiModel() {
    const setting = await this.getSettingByKey("ai_model");
    return setting?.value;
  }
  async setAiModel(model) {
    await this.upsertSetting("ai_model", model);
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
  async addLog(level, message, data, userId, username, action) {
    const logEntry = {
      id: randomUUID(),
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      message,
      userId,
      username,
      action,
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
    return this.logs.filter((log2) => log2.level === "error" && !log2.message.toLowerCase().includes("invalid credentials") && !log2.message.toLowerCase().includes("login failed")).slice(-limit).reverse();
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
  async getAiModel() {
    const setting = await this.getSettingByKey("ai_model");
    return setting?.value;
  }
  async setAiModel(model) {
    await this.upsertSetting("ai_model", model);
  }
  initializeTables() {
    this.doInitializeTables().catch(console.error);
  }
  async doInitializeTables() {
    try {
      console.log("Checking database tables...");
      try {
        await this.db.select().from(users).limit(1);
        console.log("Database tables exist and are accessible");
        return;
      } catch (tableError) {
        if (tableError.message?.includes("relation") && tableError.message?.includes("does not exist")) {
          console.log("Tables do not exist, they need to be created");
          console.log("Please run: npm run db:push");
        } else {
          console.log("Tables exist and are accessible");
        }
      }
    } catch (error) {
      console.error("Error checking tables:", error);
    }
  }
};
var storage = process.env.NODE_ENV === "production" && process.env.DATABASE_URL ? new DatabaseStorage(process.env.DATABASE_URL) : new MemStorage();

// server/routes.ts
import bcrypt from "bcrypt";
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
  app2.get("/api/test", async (req, res) => {
    await storage.addLog("info", "Test endpoint accessed", { timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    res.json({
      message: "Backend is working!",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      env: process.env.NODE_ENV
    });
  });
  app2.post("/api/test/add-logs", async (req, res) => {
    try {
      const { message, level, data } = req.body;
      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }
      const logLevel = level || "info";
      await storage.addLog(logLevel, message, data || {});
      res.json({
        success: true,
        message: "Log added successfully",
        logData: { level: logLevel, message, data }
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to add log" });
    }
  });
  app2.post("/api/debug/network", async (req, res) => {
    try {
      const { targetUrl } = req.body;
      const testUrl = targetUrl || "https://httpbin.org/get";
      await storage.addLog("info", `Network debug test to ${testUrl}`, { targetUrl: testUrl });
      const response = await fetch(testUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; DebugBot/1.0)",
          "Accept": "application/json"
        },
        signal: AbortSignal.timeout(1e4)
      });
      const responseData = await response.text();
      await storage.addLog("info", "Network debug test successful", {
        status: response.status,
        responseLength: responseData.length
      });
      res.json({
        success: true,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        data: responseData.substring(0, 500)
        // Limit response data
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await storage.addLog("error", "Network debug test failed", {
        error: errorMessage,
        targetUrl: req.body.targetUrl
      });
      res.status(500).json({
        success: false,
        error: errorMessage
      });
    }
  });
  app2.post("/api/auth/register", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ error: "Username already exists" });
      }
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      const user = await storage.createUser({ username, password: hashedPassword });
      await storage.addLog("info", "User registered", { username }, user.id, username, "register");
      if (req.session) {
        req.session.userId = user.id;
        await new Promise((resolve, reject) => {
          req.session.save((err) => {
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
      await storage.addLog("error", "Registration failed", { error: error instanceof Error ? error.message : "Unknown error" }, void 0, req.body.username, "register");
      res.status(500).json({ error: "Registration failed" });
    }
  });
  app2.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const passwordMatch = await bcrypt.compare(password, user.password);
      if (!passwordMatch) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      if (req.session) {
        req.session.userId = user.id;
        await new Promise((resolve, reject) => {
          req.session.save((err) => {
            if (err) {
              reject(err);
            } else {
              resolve(true);
            }
          });
        });
      }
      await storage.addLog("info", "User logged in", { username }, user.id, username, "login");
      res.json({
        success: true,
        user: { id: user.id, username: user.username }
      });
    } catch (error) {
      await storage.addLog("error", "Login failed", { error: error instanceof Error ? error.message : "Unknown error" }, void 0, req.body.username, "login");
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
      if (!req.session?.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      res.json({
        user: { id: user.id, username: user.username }
      });
    } catch (error) {
      res.status(500).json({ error: "Auth check failed" });
    }
  });
  app2.get("/api/chats", async (req, res) => {
    try {
      const userId = req.session?.userId;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const chats2 = await storage.getUserChats(userId);
      const user = await storage.getUser(userId);
      await storage.addLog("info", "User fetched chats", { chatCount: chats2.length }, userId, user?.username, "fetch_chats");
      res.json({ chats: chats2 });
    } catch (error) {
      const user = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      await storage.addLog("error", "Failed to fetch chats", { error: error instanceof Error ? error.message : "Unknown error" }, user?.id, user?.username, "fetch_chats");
      res.status(500).json({ error: "Failed to fetch chats" });
    }
  });
  app2.post("/api/chats", async (req, res) => {
    try {
      const userId = req.session?.userId;
      const { title } = req.body;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const chat = await storage.createChat({ userId, title });
      const user = await storage.getUser(userId);
      await storage.addLog("info", "User created chat", { chatId: chat.id, title }, userId, user?.username, "create_chat");
      res.json({ chat });
    } catch (error) {
      const user = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      await storage.addLog("error", "Failed to create chat", { error: error instanceof Error ? error.message : "Unknown error", title: req.body.title }, user?.id, user?.username, "create_chat");
      res.status(500).json({ error: "Failed to create chat" });
    }
  });
  app2.post("/api/generate", async (req, res) => {
    try {
      const { prompt, model, stream, ngrokUrl, history } = req.body;
      if (!prompt) {
        await storage.addLog("error", "Generate request missing prompt", { body: req.body });
        return res.status(400).json({ error: "Prompt is required" });
      }
      let finalPrompt = prompt;
      if (history && Array.isArray(history) && history.length > 0) {
        const historyText = history.map(
          (msg) => `${msg.type === "user" ? "Human" : "Assistant"}: ${msg.content}`
        ).join("\n");
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
      const savedNgrokUrl = await storage.getNgrokUrl();
      const targetUrl = ngrokUrl || savedNgrokUrl || "https://0c8125184293.ngrok-free.app";
      const fullUrl = `${targetUrl}/api/generate`;
      await storage.addLog("info", `AI request to ${fullUrl}`, {
        originalPrompt: prompt.substring(0, 100),
        historyCount: history?.length || 0,
        model: requestBody.model
      });
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3e4);
      try {
        const response = await fetch(fullUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; ChatBot/1.0)",
            "Accept": "application/json",
            "ngrok-skip-browser-warning": "true"
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
          const errorText = await response.text();
          await storage.addLog("error", `AI service error: ${response.status}`, {
            url: fullUrl,
            status: response.status,
            error: errorText.substring(0, 200)
          });
          return res.status(500).json({
            error: "AI service error",
            details: `Service responded with ${response.status}`
          });
        }
        const data = await response.json();
        await storage.addLog("info", "AI request successful", {
          responseLength: data.response?.length || 0
        });
        res.json(data);
      } catch (fetchError) {
        clearTimeout(timeoutId);
        const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
        if (fetchError instanceof Error && fetchError.name === "AbortError") {
          await storage.addLog("error", "AI request timeout", { timeout: "30s" });
          return res.status(408).json({
            error: "AI service timeout"
          });
        }
        const isNetworkError = errorMessage.includes("ENOTFOUND") || errorMessage.includes("ECONNREFUSED") || errorMessage.includes("ETIMEDOUT") || errorMessage.includes("fetch failed");
        if (isNetworkError) {
          await storage.addLog("error", "Network error - cannot reach AI service", {
            error: errorMessage
          });
          return res.status(503).json({
            error: "Network connectivity issue"
          });
        }
        throw fetchError;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await storage.addLog("error", "Generate endpoint error", {
        error: errorMessage
      });
      res.status(500).json({
        error: "Failed to process AI request"
      });
    }
  });
  app2.get("/api/settings/ngrok-url", async (req, res) => {
    try {
      const setting = await storage.getSettingByKey("ngrok_url");
      const ngrokUrl = setting?.value || "https://0c8125184293.ngrok-free.app";
      res.json({ ngrokUrl });
    } catch (error) {
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
      const user = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      await storage.addLog("info", "Ngrok URL changed", { newUrl: ngrokUrl }, user?.id, user?.username, "change_ngrok_url");
      res.json({ success: true, ngrokUrl });
    } catch (error) {
      const user = req.session?.userId ? await storage.getUser(req.session.userId) : null;
      await storage.addLog("error", "Failed to save ngrok URL", { error: error instanceof Error ? error.message : "Unknown error" }, user?.id, user?.username, "change_ngrok_url");
      res.status(500).json({ error: "Failed to save ngrok URL" });
    }
  });
  app2.get("/api/chats/:chatId/messages", async (req, res) => {
    try {
      const userId = req.session?.userId;
      const { chatId } = req.params;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const messages2 = await storage.getChatMessages(chatId);
      res.json({ messages: messages2 });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });
  app2.post("/api/chats/:chatId/messages", async (req, res) => {
    try {
      const userId = req.session?.userId;
      const { chatId } = req.params;
      const { content, type } = req.body;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      if (!content || !type) {
        return res.status(400).json({ error: "Content and type required" });
      }
      const message = await storage.createMessage({ chatId, content, type });
      res.json({ message });
    } catch (error) {
      res.status(500).json({ error: "Failed to create message" });
    }
  });
  app2.put("/api/chats/:chatId", async (req, res) => {
    try {
      const userId = req.session?.userId;
      const { chatId } = req.params;
      const { title } = req.body;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      if (!title) {
        return res.status(400).json({ error: "Title required" });
      }
      const chat = await storage.updateChat(chatId, title);
      res.json({ chat });
    } catch (error) {
      res.status(500).json({ error: "Failed to update chat" });
    }
  });
  app2.delete("/api/chats/:chatId", async (req, res) => {
    try {
      const userId = req.session?.userId;
      const { chatId } = req.params;
      if (!userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      await storage.deleteChat(chatId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete chat" });
    }
  });
  app2.get("/api/admin/ai-model", async (req, res) => {
    try {
      const setting = await storage.getSettingByKey("ai_model");
      const aiModel = setting?.value || "llama2:7b";
      res.json({ aiModel });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch AI model" });
    }
  });
  app2.post("/api/admin/ai-model", async (req, res) => {
    try {
      const { aiModel } = req.body;
      if (!aiModel || typeof aiModel !== "string") {
        return res.status(400).json({ error: "AI model is required" });
      }
      await storage.upsertSetting("ai_model", aiModel);
      res.json({ success: true, aiModel });
    } catch (error) {
      res.status(500).json({ error: "Failed to save AI model" });
    }
  });
  app2.get("/api/logs", async (req, res) => {
    if (process.env.NODE_ENV !== "development") {
      return res.status(403).json({ error: "Access denied" });
    }
    try {
      const logs = await storage.getLogs(50);
      res.json({ logs });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch logs" });
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
  secret: process.env.SESSION_SECRET || "replit-chat-app-session-secret-2025",
  resave: false,
  saveUninitialized: false,
  // Don't create sessions until needed - security best practice
  cookie: {
    secure: process.env.NODE_ENV === "production",
    // HTTPS only in production
    httpOnly: true,
    // Prevent XSS access to cookies
    maxAge: 24 * 60 * 60 * 1e3,
    // 24 hours
    sameSite: "strict"
    // CSRF protection
  },
  name: "sessionId"
};
if (process.env.NODE_ENV === "production" && process.env.DATABASE_URL?.includes("railway")) {
  const PgSession = connectPgSimple(session);
  sessionConfig.store = new PgSession({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true
  });
} else {
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
    if (path3.startsWith("/api") && process.env.NODE_ENV === "development") {
      log(`${req.method} ${path3} ${res.statusCode} in ${duration}ms`);
    }
  });
  next();
});
(async () => {
  const server = await registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = status === 500 && process.env.NODE_ENV === "production" ? "Server error" : err.message || "Internal Server Error";
    res.status(status).json({ error: message });
    if (process.env.NODE_ENV === "development") {
      console.error(err);
    }
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
