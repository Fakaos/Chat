// server/prod.ts
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import path from "path";
import { fileURLToPath } from "url";

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
import { eq, desc } from "drizzle-orm";
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
    return this.logs.filter((log) => log.level === "error").slice(-limit).reverse();
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
  constructor() {
    const sql2 = neon(process.env.DATABASE_URL);
    this.db = drizzle(sql2);
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
    return this.logs.filter((log) => log.level === "error").slice(-limit).reverse();
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
};
var storage = new DatabaseStorage();

// server/prod.ts
var appStorage;
if (process.env.DATABASE_URL) {
  appStorage = storage;
  console.log("Using PostgreSQL database storage");
} else {
  appStorage = new MemStorage();
  console.log("DATABASE_URL not found, using in-memory storage");
}
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
var sessionConfig = {
  secret: process.env.SESSION_SECRET || "chat-app-secret-key-change-in-production",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1e3,
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax"
  }
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
app.use("/api", (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});
app.get("/api/test", (req, res) => {
  res.json({
    message: "Backend is working!",
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    env: process.env.NODE_ENV
  });
});
app.get("/api/settings/ngrok-url", async (req, res) => {
  try {
    const ngrokUrl = await appStorage.getNgrokUrl();
    res.json({ ngrokUrl });
  } catch (error) {
    console.error("Error fetching ngrok URL:", error);
    res.status(500).json({ error: "Failed to fetch ngrok URL" });
  }
});
app.post("/api/settings/ngrok-url", async (req, res) => {
  try {
    const { ngrokUrl } = req.body;
    if (!ngrokUrl) {
      return res.status(400).json({ error: "ngrokUrl is required" });
    }
    await appStorage.setNgrokUrl(ngrokUrl);
    res.json({ ngrokUrl });
  } catch (error) {
    console.error("Error saving ngrok URL:", error);
    res.status(500).json({ error: "Failed to save ngrok URL" });
  }
});
app.get("/api/logs", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const logs = await appStorage.getLogs(limit);
    res.json({ logs });
  } catch (error) {
    console.error("Error fetching logs:", error);
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});
app.get("/api/errors", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const errors = await appStorage.getErrors(limit);
    res.json({ errors });
  } catch (error) {
    console.error("Error fetching errors:", error);
    res.status(500).json({ error: "Failed to fetch errors" });
  }
});
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }
    const existingUser = await appStorage.getUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: "Username already exists" });
    }
    const user = await appStorage.createUser({ username, password });
    await appStorage.addLog("info", "User registered", { username });
    if (req.session) {
      req.session.userId = user.id;
    }
    res.json({
      success: true,
      user: { id: user.id, username: user.username }
    });
  } catch (error) {
    console.error("Registration error:", error);
    await appStorage.addLog("error", "Registration failed", { error: error instanceof Error ? error.message : "Unknown error" });
    res.status(500).json({ error: "Registration failed" });
  }
});
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password required" });
    }
    const user = await appStorage.getUserByUsername(username);
    if (!user || user.password !== password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    if (req.session) {
      req.session.userId = user.id;
    }
    await appStorage.addLog("info", "User logged in", { username });
    res.json({
      success: true,
      user: { id: user.id, username: user.username }
    });
  } catch (error) {
    console.error("Login error:", error);
    await appStorage.addLog("error", "Login failed", { error: error instanceof Error ? error.message : "Unknown error" });
    res.status(500).json({ error: "Login failed" });
  }
});
app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed" });
    }
    res.json({ success: true });
  });
});
app.get("/api/auth/me", async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const user = await appStorage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    res.json({
      user: { id: user.id, username: user.username }
    });
  } catch (error) {
    console.error("Auth check error:", error);
    res.status(500).json({ error: "Auth check failed" });
  }
});
app.get("/api/chats", async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const chats2 = await appStorage.getUserChats(userId);
    res.json({ chats: chats2 });
  } catch (error) {
    console.error("Error fetching chats:", error);
    res.status(500).json({ error: "Failed to fetch chats" });
  }
});
app.post("/api/chats", async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { title } = req.body;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const chat = await appStorage.createChat({ userId, title });
    res.json({ chat });
  } catch (error) {
    console.error("Error creating chat:", error);
    res.status(500).json({ error: "Failed to create chat" });
  }
});
app.get("/api/chats/:chatId/messages", async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { chatId } = req.params;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const messages2 = await appStorage.getChatMessages(chatId);
    res.json({ messages: messages2 });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});
app.post("/api/chats/:chatId/messages", async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { chatId } = req.params;
    const { type, content } = req.body;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const message = await appStorage.createMessage({ chatId, type, content });
    res.json({ message });
  } catch (error) {
    console.error("Error creating message:", error);
    res.status(500).json({ error: "Failed to create message" });
  }
});
app.put("/api/chats/:chatId", async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { chatId } = req.params;
    const { title } = req.body;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const chat = await appStorage.updateChat(chatId, title);
    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }
    res.json({ chat });
  } catch (error) {
    console.error("Error updating chat:", error);
    res.status(500).json({ error: "Failed to update chat" });
  }
});
app.delete("/api/chats/:chatId", async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { chatId } = req.params;
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    const deleted = await appStorage.deleteChat(chatId);
    res.json({ success: deleted });
  } catch (error) {
    console.error("Error deleting chat:", error);
    res.status(500).json({ error: "Failed to delete chat" });
  }
});
app.post("/api/generate", async (req, res) => {
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
      throw new Error(`Ngrok API error: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      const text2 = await response.text();
      console.log("Non-JSON response from ngrok:", text2.substring(0, 200));
      throw new Error("Ngrok endpoint returned non-JSON response (probably HTML error page)");
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Proxy error:", error);
    res.status(500).json({
      error: "Failed to connect to AI service",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});
var staticPath = path.resolve(__dirname, "public");
app.use(express.static(staticPath));
app.get("*", (req, res) => {
  res.sendFile(path.resolve(staticPath, "index.html"));
});
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  res.status(status).json({ message });
});
var port = parseInt(process.env.PORT || "5000", 10);
app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
});
