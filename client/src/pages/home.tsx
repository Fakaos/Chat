import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface ChatMessage {
  id: string;
  type: 'user' | 'ai';
  content: string;
  timestamp: string;
}

interface LlamaResponse {
  response: string;
}

export default function Home() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const { toast } = useToast();

  const chatMutation = useMutation({
    mutationFn: async (prompt: string): Promise<LlamaResponse> => {
      const response = await fetch('https://0c8125184293.ngrok-free.app/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: "llama2:7b",
          prompt: prompt,
          stream: false
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return response.json();
    },
    onSuccess: (data, prompt) => {
      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        type: 'user',
        content: prompt,
        timestamp: getCurrentTime()
      };

      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'ai',
        content: data.response || 'Odpověď byla přijata, ale obsah není dostupný.',
        timestamp: getCurrentTime()
      };

      setMessages(prev => [...prev, userMessage, aiMessage]);
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

  const handleSubmit = (e: React.FormEvent) => {
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

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-slate-800 mb-2">
            <i className="fas fa-comments text-blue-600 mr-3"></i>
            Chat Aplikace
          </h1>
          <p className="text-slate-600">Jednoduchá komunikace s AI modelem</p>
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
  );
}
