import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import ChatSidebar from "@/components/chat-sidebar";

interface ChatMessage {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: string;
}

interface LlamaResponse {
  response: string;
}

interface User {
  id: string;
  username: string;
}

interface HomeProps {
  currentUser: User | null;
  isGuest: boolean;
  onLogout: () => void;
}

export default function Home({ currentUser, isGuest, onLogout }: HomeProps) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [ngrokUrl, setNgrokUrl] = useState("https://0c8125184293.ngrok-free.app");
  const [tempNgrokUrl, setTempNgrokUrl] = useState("");
  const [tempAiModel, setTempAiModel] = useState("");
  const [aiModel, setAiModel] = useState("llama2:7b");
  const [isLoadingUrl, setIsLoadingUrl] = useState(true);
  const [showLogs, setShowLogs] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [errors, setErrors] = useState<any[]>([]);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Načtení ngrok URL a AI modelu při načtení komponenty
  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Load ngrok URL
        const ngrokResponse = await fetch('/api/settings/ngrok-url');
        console.log('Ngrok response status:', ngrokResponse.status);
        if (ngrokResponse.ok) {
          const data = await ngrokResponse.json();
          console.log('Loaded ngrok URL:', data.ngrokUrl);
          setNgrokUrl(data.ngrokUrl);
        } else {
          console.error('Failed to load ngrok URL, status:', ngrokResponse.status);
        }
        
        // Load AI model
        const modelResponse = await fetch('/api/admin/ai-model');
        console.log('AI model response status:', modelResponse.status);
        if (modelResponse.ok) {
          const modelData = await modelResponse.json();
          console.log('Loaded AI model:', modelData.aiModel);
          setAiModel(modelData.aiModel);
        } else {
          console.error('Failed to fetch AI model');
        }
      } catch (error) {
        console.error('Error loading settings:', error);
        // Fallback na default hodnotu
        setNgrokUrl("https://0c8125184293.ngrok-free.app");
      } finally {
        setIsLoadingUrl(false);
      }
    };

    loadSettings();
  }, []);

  const chatMutation = useMutation({
    mutationFn: async (prompt: string): Promise<LlamaResponse> => {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: aiModel,
          prompt: prompt,
          stream: false,
          ngrokUrl: ngrokUrl
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return response.json();
    },
    onSuccess: async (data) => {
      const aiMessage: ChatMessage = {
        id: Date.now().toString(),
        type: 'ai',
        content: data.response || 'Odpověď byla přijata, ale obsah není dostupný.',
        timestamp: getCurrentTime()
      };

      setMessages(prev => [...prev, aiMessage]);

      // Uložit AI odpověď do databáze pokud není guest
      if (!isGuest && currentChatId && currentUser) {
        try {
          await fetch(`/api/chats/${currentChatId}/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ type: 'ai', content: aiMessage.content })
          });
        } catch (error) {
          console.error('Error saving AI message:', error);
        }
      }
    },
    onError: (error) => {
      toast({
        title: "Chyba připojení",
        description: "Nepodařilo se připojit k serveru. Zkuste to prosím znovu.",
        variant: "destructive"
      });
      console.error('API Error:', error);
    }
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      toast({
        title: "Chyba",
        description: "Prosím zadejte zprávu před odesláním.",
        variant: "destructive"
      });
      return;
    }

    if (chatMutation.isPending) return;

    // Pokud není aktuální chat a uživatel není guest, vytvoř automaticky nový chat
    let chatId = currentChatId;
    if (!isGuest && !chatId && currentUser) {
      try {
        const response = await fetch('/api/chats', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({ title: `Chat ${new Date().toLocaleString('cs-CZ').slice(0, 16)}` })
        });
        
        if (response.ok) {
          const data = await response.json();
          chatId = data.chat.id;
          setCurrentChatId(chatId);
          queryClient.invalidateQueries({ queryKey: ['user-chats'] });
          console.log('Auto-created chat:', data.chat.id);
        } else {
          console.error('Failed to auto-create chat:', response.status);
          toast({
            title: "Chyba",
            description: "Nepodařilo se vytvořit chat. Zkuste se znovu přihlásit.",
            variant: "destructive"
          });
          return;
        }
      } catch (error) {
        console.error('Error auto-creating chat:', error);
        toast({
          title: "Chyba připojení",
          description: "Nepodařilo se připojit k serveru.",
          variant: "destructive"
        });
        return;
      }
    }

    // Přidej user zprávu ihned
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: trimmedMessage,
      timestamp: getCurrentTime()
    };
    setMessages(prev => [...prev, userMessage]);

    // Uložit zprávu do databáze pokud není guest
    if (!isGuest && chatId && currentUser) {
      try {
        await fetch(`/api/chats/${chatId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ type: 'user', content: trimmedMessage })
        });
      } catch (error) {
        console.error('Error saving message:', error);
      }
    }

    chatMutation.mutate(trimmedMessage);
    setMessage("");
  };

  const getCurrentTime = () => {
    return new Date().toLocaleTimeString('cs-CZ', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  const handleAdminLogin = () => {
    if (adminPassword === '270602') {
      setIsAdminAuthenticated(true);
      // Nastavit tempNgrokUrl na aktuální ngrokUrl při přihlášení
      setTempNgrokUrl(ngrokUrl || "https://0c8125184293.ngrok-free.app");
      setTempAiModel(aiModel);
      toast({
        title: "Přihlášení úspěšné",
        description: "Vítejte v admin panelu!",
      });
    } else {
      toast({
        title: "Chybné heslo",
        description: "Prosím zadejte správné heslo.",
        variant: "destructive"
      });
    }
    setAdminPassword("");
  };

  const saveNgrokUrlMutation = useMutation({
    mutationFn: async (url: string) => {
      const response = await fetch('/api/settings/ngrok-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ngrokUrl: url })
      });

      if (!response.ok) {
        throw new Error('Failed to save URL');
      }

      return response.json();
    },
    onSuccess: (data) => {
      setNgrokUrl(data.ngrokUrl);
      setShowAdminPanel(false);
      toast({
        title: "URL aktualizována",
        description: "Nová ngrok URL byla globálně uložena.",
      });
    },
    onError: (error) => {
      toast({
        title: "Chyba při ukládání",
        description: "Nepodařilo se uložit ngrok URL. Zkuste to znovu.",
        variant: "destructive"
      });
    }
  });

  const handleSaveNgrokUrl = () => {
    if (tempNgrokUrl.trim()) {
      saveNgrokUrlMutation.mutate(tempNgrokUrl.trim());
    }
  };

  const saveAiModelMutation = useMutation({
    mutationFn: async (model: string) => {
      const response = await fetch('/api/admin/ai-model', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ aiModel: model })
      });
      
      if (!response.ok) {
        throw new Error('Failed to save AI model');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      setAiModel(data.aiModel);
      setTempAiModel(data.aiModel);
      toast({
        title: "Úspěch",
        description: "AI model byl úspěšně uložen."
      });
    },
    onError: (error) => {
      toast({
        title: "Chyba",
        description: "Nepodařilo se uložit AI model.",
        variant: "destructive"
      });
      console.error('Error saving AI model:', error);
    }
  });

  const handleSaveAiModel = () => {
    if (tempAiModel.trim()) {
      saveAiModelMutation.mutate(tempAiModel.trim());
    }
  };

  const handleAdminLogout = () => {
    setIsAdminAuthenticated(false);
    setShowAdminPanel(false);
    setTempNgrokUrl("");
    setShowLogs(false);
    setShowErrors(false);
  };

  const fetchLogs = async () => {
    try {
      const response = await fetch('/api/logs');
      console.log('Logs response status:', response.status);
      
      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to fetch logs');
        } else {
          const text = await response.text();
          console.log('Non-JSON logs response:', text.substring(0, 200));
          throw new Error(`Server error: ${response.status}`);
        }
      }
      
      const data = await response.json();
      setLogs(data.logs);
      setShowLogs(true);
      setShowErrors(false);
    } catch (error) {
      console.error('Fetch logs error:', error);
      toast({
        title: "Chyba",
        description: error instanceof Error ? error.message : "Nepodařilo se načíst logy.",
        variant: "destructive"
      });
    }
  };

  const fetchErrors = async () => {
    try {
      const response = await fetch('/api/errors');
      console.log('Errors response status:', response.status);
      
      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to fetch errors');
        } else {
          const text = await response.text();
          console.log('Non-JSON errors response:', text.substring(0, 200));
          throw new Error(`Server error: ${response.status}`);
        }
      }
      
      const data = await response.json();
      setErrors(data.errors);
      setShowErrors(true);
      setShowLogs(false);
    } catch (error) {
      console.error('Fetch errors error:', error);
      toast({
        title: "Chyba",
        description: error instanceof Error ? error.message : "Nepodařilo se načíst errory.",
        variant: "destructive"
      });
    }
  };

  const handleChatSelect = async (chatId: string) => {
    setCurrentChatId(chatId);
    setMessages([]); // Clear current messages
    
    // Načti zprávy z vybraného chatu
    try {
      const response = await fetch(`/api/chats/${chatId}/messages`);
      if (response.ok) {
        const data = await response.json();
        const formattedMessages = data.messages.map((msg: any) => ({
          id: msg.id,
          type: msg.type,
          content: msg.content,
          timestamp: new Date(msg.createdAt).toLocaleTimeString('cs-CZ', { 
            hour: '2-digit', 
            minute: '2-digit' 
          })
        }));
        setMessages(formattedMessages);
      }
    } catch (error) {
      console.error('Error loading chat messages:', error);
    }
  };

  const handleNewChat = async () => {
    setCurrentChatId(null);
    setMessages([]);
    console.log('New chat initiated from home');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar for authenticated users */}
      {!isGuest && currentUser && (
        <ChatSidebar
          currentUser={currentUser}
          currentChatId={currentChatId}
          onChatSelect={handleChatSelect}
          onNewChat={handleNewChat}
          onLogout={onLogout}
        />
      )}

      {/* Main content */}
      <div className={`flex-1 flex items-center justify-center p-4 ${!isGuest && currentUser ? '' : 'min-h-screen'}`}>
        {/* Admin Button */}
        <div className="fixed top-4 right-4 z-10">
          <Dialog open={showAdminPanel} onOpenChange={setShowAdminPanel}>
          <DialogTrigger asChild>
            <Button
              variant="outline" 
              size="sm"
              className="bg-white hover:bg-slate-50 border-slate-300"
              data-testid="button-admin"
            >
              <i className="fas fa-cog mr-2 text-sm"></i>
              Admin
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md" data-testid="admin-panel">
            <DialogHeader>
              <DialogTitle>Admin Panel</DialogTitle>
            </DialogHeader>
            
            {!isAdminAuthenticated ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="admin-password" className="text-sm font-medium">
                    Heslo:
                  </label>
                  <Input
                    id="admin-password"
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAdminLogin()}
                    placeholder="Zadejte admin heslo"
                    data-testid="input-admin-password"
                  />
                </div>
                <div className="flex space-x-2">
                  <Button onClick={handleAdminLogin} className="flex-1" data-testid="button-admin-login">
                    Přihlásit
                  </Button>
                  <Button variant="outline" onClick={() => setShowAdminPanel(false)} className="flex-1">
                    Zrušit
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {!showLogs && !showErrors ? (
                  <>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label htmlFor="ngrok-url" className="text-sm font-medium">
                          Ngrok URL:
                        </label>
                        <Input
                          id="ngrok-url"
                          type="url"
                          value={tempNgrokUrl}
                          onChange={(e) => setTempNgrokUrl(e.target.value)}
                          placeholder="https://xxxxx.ngrok-free.app"
                          data-testid="input-ngrok-url"
                        />
                        <p className="text-xs text-slate-500">
                          Aktuální: {isLoadingUrl ? 'Načítá se...' : ngrokUrl}
                        </p>
                      </div>
                      
                      <div className="space-y-2">
                        <label htmlFor="ai-model" className="text-sm font-medium">
                          AI Model:
                        </label>
                        <Input
                          id="ai-model"
                          type="text"
                          value={tempAiModel}
                          onChange={(e) => setTempAiModel(e.target.value)}
                          placeholder="llama2:7b"
                          data-testid="input-ai-model"
                        />
                        <p className="text-xs text-slate-500">
                          Aktuální: {aiModel}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex space-x-2">
                        <Button 
                          onClick={handleSaveNgrokUrl} 
                          className="flex-1" 
                          data-testid="button-save-url"
                          disabled={saveNgrokUrlMutation.isPending}
                        >
                          {saveNgrokUrlMutation.isPending ? 'Ukládá URL...' : 'Uložit URL'}
                        </Button>
                        <Button 
                          onClick={handleSaveAiModel} 
                          className="flex-1" 
                          data-testid="button-save-model"
                          disabled={saveAiModelMutation.isPending}
                        >
                          {saveAiModelMutation.isPending ? 'Ukládá model...' : 'Uložit Model'}
                        </Button>
                      </div>
                      <Button variant="outline" onClick={handleAdminLogout} className="w-full">
                        Odhlásit
                      </Button>
                    </div>
                    <div className="border-t pt-4">
                      <div className="grid grid-cols-2 gap-2">
                        <Button variant="outline" onClick={fetchLogs} className="text-sm">
                          <i className="fas fa-list mr-2"></i>
                          Zobrazit logy
                        </Button>
                        <Button variant="outline" onClick={fetchErrors} className="text-sm">
                          <i className="fas fa-exclamation-triangle mr-2"></i>
                          Zobrazit errory
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-medium">
                        {showLogs ? 'Systémové logy' : 'Chybové logy'}
                      </h3>
                      <Button variant="ghost" size="sm" onClick={() => { setShowLogs(false); setShowErrors(false); }}>
                        <i className="fas fa-times"></i>
                      </Button>
                    </div>
                    <div className="max-h-64 overflow-y-auto border rounded p-2 text-xs font-mono bg-slate-50">
                      {(showLogs ? logs : errors).map((entry, index) => (
                        <div key={entry.id || index} className="mb-2 pb-1 border-b border-slate-200 last:border-b-0">
                          <div className="flex justify-between text-slate-600 mb-1">
                            <span className={`px-1 rounded text-xs ${
                              entry.level === 'error' ? 'bg-red-100 text-red-700' : 
                              entry.level === 'warn' ? 'bg-yellow-100 text-yellow-700' : 
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {entry.level.toUpperCase()}
                            </span>
                            <span>{new Date(entry.timestamp).toLocaleString('cs-CZ')}</span>
                          </div>
                          {entry.username && entry.action && (
                            <div className="text-slate-600 text-xs mb-1">
                              <span className="font-medium">{entry.username}</span> - {entry.action}
                            </div>
                          )}
                          <div className="text-slate-800">{entry.message}</div>
                          {entry.data && (
                            <div className="text-slate-500 text-xs mt-1">
                              {JSON.stringify(entry.data, null, 2)}
                            </div>
                          )}
                        </div>
                      ))}
                      {(showLogs ? logs : errors).length === 0 && (
                        <div className="text-slate-500 text-center py-4">
                          {showLogs ? 'Žádné logy k zobrazení' : 'Žádné errory k zobrazení'}
                        </div>
                      )}
                    </div>
                    <Button variant="outline" onClick={() => { setShowLogs(false); setShowErrors(false); }} className="w-full">
                      Zpět na nastavení
                    </Button>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
        </div>

        <div className="w-full max-w-2xl">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-semibold text-slate-800 mb-2">
              <i className="fas fa-comments text-blue-600 mr-3"></i>
              Chat Aplikace
            </h1>
            <p className="text-slate-600">
              {isGuest ? 'Host režim - Jednoduchá komunikace s AI modelem' : 
               currentUser ? `Vítejte, ${currentUser.username}!` : 
               'Jednoduchá komunikace s AI modelem'}
            </p>
            {isGuest && (
              <div className="mt-4">
                <Button variant="outline" onClick={onLogout} size="sm">
                  <i className="fas fa-sign-in-alt mr-2"></i>
                  Přihlásit se
                </Button>
              </div>
            )}
          </div>

        {/* Chat Container */}
        <Card className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
          
          {/* Response Area */}
          <div className="h-96 overflow-y-auto p-6 bg-slate-50 border-b border-slate-200">
            <div className="space-y-4">
              {/* Welcome message */}
              <div className="flex items-start space-x-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <i className="fas fa-robot text-blue-600 text-sm"></i>
                </div>
                <div className="bg-white rounded-xl rounded-tl-none px-4 py-3 shadow-sm border border-slate-200 max-w-md">
                  <p className="text-slate-700 text-sm">Vítejte! Napište zprávu a stiskněte Odeslat pro komunikaci s AI modelem.</p>
                </div>
              </div>
              
              {/* Messages */}
              {messages.map((msg) => (
                <div key={msg.id} className={`flex items-start space-x-3 ${msg.type === 'user' ? 'justify-end' : ''}`}>
                  {msg.type === 'user' ? (
                    <>
                      <div className="bg-blue-600 text-white rounded-xl rounded-tr-none px-4 py-3 max-w-md shadow-sm">
                        <p className="text-sm" data-testid={`message-user-${msg.id}`}>{msg.content}</p>
                        <p className="text-xs text-blue-100 mt-1">{msg.timestamp}</p>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                        <i className="fas fa-user text-white text-sm"></i>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <i className="fas fa-robot text-blue-600 text-sm"></i>
                      </div>
                      <div className="bg-white rounded-xl rounded-tl-none px-4 py-3 shadow-sm border border-slate-200 max-w-md">
                        <p className="text-slate-700 text-sm" data-testid={`message-ai-${msg.id}`}>{msg.content}</p>
                        <p className="text-xs text-slate-500 mt-1">{msg.timestamp}</p>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Input Form */}
          <div className="p-6 bg-white">
            <form onSubmit={handleSubmit} className="flex space-x-4" data-testid="chat-form">
              {/* Message Input */}
              <div className="flex-1 relative">
                <Input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Napište svou zprávu..."
                  className="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 text-slate-700"
                  disabled={chatMutation.isPending}
                  data-testid="input-message"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                  <i className="fas fa-pencil-alt text-slate-400 text-sm"></i>
                </div>
              </div>

              {/* Send Button */}
              <Button
                type="submit"
                disabled={chatMutation.isPending || !message.trim()}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white px-6 py-3 rounded-xl font-medium transition-all duration-200 flex items-center space-x-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                data-testid="button-send"
              >
                <span data-testid="button-text">
                  {chatMutation.isPending ? 'Odesílám...' : 'Odeslat'}
                </span>
                {chatMutation.isPending ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                ) : (
                  <i className="fas fa-paper-plane text-sm"></i>
                )}
              </Button>
            </form>

            {/* Loading Indicator */}
            {chatMutation.isPending && (
              <div className="mt-4 flex items-center justify-center space-x-2 text-slate-600" data-testid="loading-indicator">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent"></div>
                <span className="text-sm">Zpracovávám odpověď...</span>
              </div>
            )}
          </div>
        </Card>

        {/* Footer info */}
        <div className="text-center mt-6 text-slate-500 text-sm">
          <p>
            <i className="fas fa-info-circle mr-1"></i>
            Komunikace probíhá s modelem Llama2:7b
          </p>
        </div>
        </div>
      </div>
    </div>
  );
}
