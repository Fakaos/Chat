import { type User, type InsertUser, type Setting, type InsertSetting, type Chat, type InsertChat, type Message, type InsertMessage } from "@shared/schema";
import { randomUUID } from "crypto";

// modify the interface with any CRUD methods
// you might need

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'error' | 'warn';
  message: string;
  data?: any;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getSettingByKey(key: string): Promise<Setting | undefined>;
  upsertSetting(key: string, value: string): Promise<Setting>;
  addLog(level: 'info' | 'error' | 'warn', message: string, data?: any): Promise<void>;
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

  async addLog(level: 'info' | 'error' | 'warn', message: string, data?: any): Promise<void> {
    const logEntry: LogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      level,
      message,
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
      .filter(log => log.level === 'error')
      .slice(-limit)
      .reverse();
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

export const storage = new MemStorage();
