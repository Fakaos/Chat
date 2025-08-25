import { type User, type InsertUser, type Setting, type InsertSetting, type Chat, type InsertChat, type Message, type InsertMessage, type LogEntry, users, settings, chats, messages } from "@shared/schema";
import { randomUUID } from "crypto";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
const { Pool } = pkg;
import { eq, desc } from "drizzle-orm";

// modify the interface with any CRUD methods
// you might need


export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getSettingByKey(key: string): Promise<Setting | undefined>;
  upsertSetting(key: string, value: string): Promise<Setting>;
  addLog(level: 'info' | 'error' | 'warn', message: string, data?: any, userId?: string, username?: string, action?: string): Promise<void>;
  getLogs(limit?: number): Promise<LogEntry[]>;
  getErrors(limit?: number): Promise<LogEntry[]>;
  // Chat methods
  getUserChats(userId: string): Promise<Chat[]>;
  createChat(chat: InsertChat): Promise<Chat>;
  updateChat(chatId: string, title: string): Promise<Chat | undefined>;
  deleteChat(chatId: string): Promise<boolean>;
  // Message methods
  getChatMessages(chatId: string): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  // Ngrok URL methods
  getNgrokUrl(): Promise<string | undefined>;
  setNgrokUrl(url: string): Promise<void>;
  // AI Model methods
  getAiModel(): Promise<string | undefined>;
  setAiModel(model: string): Promise<void>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private settings: Map<string, Setting>;
  private chats: Map<string, Chat>;
  private messages: Map<string, Message>;
  private logs: LogEntry[] = [];

  constructor() {
    this.users = new Map();
    this.settings = new Map();
    this.chats = new Map();
    this.messages = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id, createdAt: new Date() };
    this.users.set(id, user);
    return user;
  }

  async getSettingByKey(key: string): Promise<Setting | undefined> {
    return this.settings.get(key);
  }

  async upsertSetting(key: string, value: string): Promise<Setting> {
    const existing = this.settings.get(key);
    if (existing) {
      const updated: Setting = { ...existing, value };
      this.settings.set(key, updated);
      return updated;
    } else {
      const id = randomUUID();
      const setting: Setting = { id, key, value };
      this.settings.set(key, setting);
      return setting;
    }
  }

  async addLog(level: 'info' | 'error' | 'warn', message: string, data?: any, userId?: string, username?: string, action?: string): Promise<void> {
    const logEntry: LogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      level,
      message,
      userId,
      username,
      action,
      data
    };
    
    this.logs.push(logEntry);
    
    // Omezit na posledních 1000 logů
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
    }
  }

  async getLogs(limit: number = 50): Promise<LogEntry[]> {
    return this.logs.slice(-limit).reverse();
  }

  async getErrors(limit: number = 50): Promise<LogEntry[]> {
    return this.logs
      .filter(log => log.level === 'error' && !log.message.toLowerCase().includes('invalid credentials') && !log.message.toLowerCase().includes('login failed'))
      .slice(-limit)
      .reverse();
  }

  async getNgrokUrl(): Promise<string | undefined> {
    const setting = await this.getSettingByKey('ngrok_url');
    return setting?.value;
  }

  async setNgrokUrl(url: string): Promise<void> {
    await this.upsertSetting('ngrok_url', url);
  }

  async getAiModel(): Promise<string | undefined> {
    const setting = await this.getSettingByKey('ai_model');
    return setting?.value;
  }

  async setAiModel(model: string): Promise<void> {
    await this.upsertSetting('ai_model', model);
  }

  // Chat methods
  async getUserChats(userId: string): Promise<Chat[]> {
    return Array.from(this.chats.values())
      .filter(chat => chat.userId === userId)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
  }

  async createChat(insertChat: InsertChat): Promise<Chat> {
    const id = randomUUID();
    const now = new Date();
    const chat: Chat = { 
      id,
      userId: insertChat.userId || null,
      title: insertChat.title,
      createdAt: now,
      updatedAt: now
    };
    this.chats.set(id, chat);
    return chat;
  }

  async updateChat(chatId: string, title: string): Promise<Chat | undefined> {
    const chat = this.chats.get(chatId);
    if (chat) {
      const updated: Chat = { ...chat, title, updatedAt: new Date() };
      this.chats.set(chatId, updated);
      return updated;
    }
    return undefined;
  }

  async deleteChat(chatId: string): Promise<boolean> {
    // Delete all messages in the chat first
    Array.from(this.messages.keys()).forEach(messageId => {
      const message = this.messages.get(messageId);
      if (message?.chatId === chatId) {
        this.messages.delete(messageId);
      }
    });
    
    return this.chats.delete(chatId);
  }

  // Message methods
  async getChatMessages(chatId: string): Promise<Message[]> {
    return Array.from(this.messages.values())
      .filter(message => message.chatId === chatId)
      .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const id = randomUUID();
    const message: Message = { 
      ...insertMessage, 
      id, 
      createdAt: new Date()
    };
    this.messages.set(id, message);
    
    // Update chat's updatedAt timestamp
    const chat = this.chats.get(insertMessage.chatId);
    if (chat) {
      const updated: Chat = { ...chat, updatedAt: new Date() };
      this.chats.set(insertMessage.chatId, updated);
    }
    
    return message;
  }
}

// Database storage implementation
export class DatabaseStorage implements IStorage {
  private db;
  private logs: LogEntry[] = []; // Keep logs in memory for now

  constructor(databaseUrl: string) {
    if (!databaseUrl) {
      throw new Error('Database URL is required for DatabaseStorage');
    }
    
    // Use standard PostgreSQL client for Railway
    if (process.env.NODE_ENV === 'production' || databaseUrl.includes('railway')) {
      console.log('Using standard PostgreSQL client for Railway');
      const pool = new Pool({
        connectionString: databaseUrl,
        ssl: databaseUrl.includes('railway') ? { rejectUnauthorized: false } : false
      });
      this.db = pgDrizzle(pool);
      
      // Initialize tables for Railway
      this.initializeTables();
    } else {
      // Use Neon for development (Replit)
      console.log('Using Neon client for development');
      const sql = neon(databaseUrl);
      this.db = drizzle(sql);
      
      // Also initialize tables for Replit if using external database
      if (databaseUrl && !databaseUrl.includes('neon')) {
        this.initializeTables();
      }
    }
  }

  async getUser(id: string): Promise<User | undefined> {
    const result = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await this.db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await this.db.insert(users).values(insertUser).returning();
    return result[0];
  }

  async getSettingByKey(key: string): Promise<Setting | undefined> {
    const result = await this.db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return result[0];
  }

  async upsertSetting(key: string, value: string): Promise<Setting> {
    const existing = await this.getSettingByKey(key);
    if (existing) {
      const result = await this.db.update(settings)
        .set({ value })
        .where(eq(settings.key, key))
        .returning();
      return result[0];
    } else {
      const result = await this.db.insert(settings)
        .values({ key, value })
        .returning();
      return result[0];
    }
  }

  async addLog(level: 'info' | 'error' | 'warn', message: string, data?: any, userId?: string, username?: string, action?: string): Promise<void> {
    const logEntry: LogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      level,
      message,
      userId,
      username,
      action,
      data
    };
    
    this.logs.push(logEntry);
    
    // Omezit na posledních 1000 logů
    if (this.logs.length > 1000) {
      this.logs = this.logs.slice(-1000);
    }
  }

  async getLogs(limit: number = 50): Promise<LogEntry[]> {
    return this.logs.slice(-limit).reverse();
  }

  async getErrors(limit: number = 50): Promise<LogEntry[]> {
    return this.logs
      .filter(log => log.level === 'error' && !log.message.toLowerCase().includes('invalid credentials') && !log.message.toLowerCase().includes('login failed'))
      .slice(-limit)
      .reverse();
  }

  async getUserChats(userId: string): Promise<Chat[]> {
    const result = await this.db.select()
      .from(chats)
      .where(eq(chats.userId, userId))
      .orderBy(desc(chats.updatedAt));
    return result;
  }

  async createChat(insertChat: InsertChat): Promise<Chat> {
    const result = await this.db.insert(chats).values(insertChat).returning();
    return result[0];
  }

  async updateChat(chatId: string, title: string): Promise<Chat | undefined> {
    const result = await this.db.update(chats)
      .set({ title, updatedAt: new Date() })
      .where(eq(chats.id, chatId))
      .returning();
    return result[0];
  }

  async deleteChat(chatId: string): Promise<boolean> {
    // Smaž nejdřív zprávy
    await this.db.delete(messages).where(eq(messages.chatId, chatId));
    // Pak smaž chat
    const result = await this.db.delete(chats).where(eq(chats.id, chatId));
    return true;
  }

  async getChatMessages(chatId: string): Promise<Message[]> {
    const result = await this.db.select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(messages.createdAt);
    return result;
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const result = await this.db.insert(messages).values(insertMessage).returning();
    
    // Update chat's updatedAt timestamp
    await this.db.update(chats)
      .set({ updatedAt: new Date() })
      .where(eq(chats.id, insertMessage.chatId));
    
    return result[0];
  }

  async getNgrokUrl(): Promise<string | undefined> {
    const setting = await this.getSettingByKey('ngrok_url');
    return setting?.value;
  }

  async setNgrokUrl(url: string): Promise<void> {
    await this.upsertSetting('ngrok_url', url);
  }

  async getAiModel(): Promise<string | undefined> {
    const setting = await this.getSettingByKey('ai_model');
    return setting?.value;
  }

  async setAiModel(model: string): Promise<void> {
    await this.upsertSetting('ai_model', model);
  }

  private initializeTables(): void {
    // Run async initialization
    this.doInitializeTables().catch(console.error);
  }

  private async doInitializeTables(): Promise<void> {
    try {
      console.log('Checking database tables...');
      
      // Try to query one of the tables to see if they exist
      try {
        await this.db.select().from(users).limit(1);
        console.log('Database tables exist and are accessible');
        return;
      } catch (tableError: any) {
        if (tableError.message?.includes('relation') && tableError.message?.includes('does not exist')) {
          console.log('Tables do not exist, they need to be created');
          console.log('Please run: npm run db:push');
        } else {
          console.log('Tables exist and are accessible');
        }
      }
      
    } catch (error) {
      console.error('Error checking tables:', error);
    }
  }
}

// Export storage instance conditionally - use MemStorage for development to avoid SSL issues
export const storage = (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) ? 
  new DatabaseStorage(process.env.DATABASE_URL) : 
  new MemStorage();
