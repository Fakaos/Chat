import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface ChatSidebarProps {
  currentUser: { id: string; username: string };
  currentChatId: string | null;
  onChatSelect: (chatId: string) => void;
  onNewChat: () => void;
  onLogout: () => void;
}

export default function ChatSidebar({ 
  currentUser, 
  currentChatId, 
  onChatSelect, 
  onNewChat,
  onLogout 
}: ChatSidebarProps) {
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch user's chats with credentials
  const { data: chatsData, isLoading, error } = useQuery({
    queryKey: ['user-chats', currentUser.id],
    queryFn: async () => {
      console.log('Fetching chats for user:', currentUser.id);
      const response = await fetch('/api/chats', {
        method: 'GET',
        credentials: 'include', // Include session cookies
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        }
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          console.log('User not authenticated, will need to re-login');
          throw new Error('Not authenticated');
        }
        const errorText = await response.text();
        console.error('Failed to fetch chats:', response.status, errorText);
        throw new Error(`Failed to fetch chats: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Fetched chats:', data);
      return data;
    },
    enabled: !!currentUser?.id, // Only fetch when user is logged in
    refetchInterval: 30000, // Refresh every 30 seconds (less frequent)
    retry: (failureCount, error) => {
      // Don't retry auth errors
      if (error.message.includes('Not authenticated')) {
        return false;
      }
      return failureCount < 2; // Retry max 2 times for other errors
    },
    retryDelay: 2000 // Wait 2 seconds between retries
  });

  const chats: Chat[] = chatsData?.chats || [];

  // Create new chat mutation
  const createChatMutation = useMutation({
    mutationFn: async () => {
      const chatNumber = chats.length + 1;
      const title = `Chat ${chatNumber}`;
      
      console.log('Creating new chat:', title);
      const response = await fetch('/api/chats', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ title })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to create chat:', response.status, errorText);
        throw new Error('Failed to create chat');
      }

      const data = await response.json();
      console.log('Created chat:', data);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['user-chats'] });
      onChatSelect(data.chat.id);
      toast({
        title: "Úspěch",
        description: "Nový chat byl vytvořen.",
      });
    },
    onError: (error) => {
      console.error('Create chat error:', error);
      toast({
        title: "Chyba",
        description: "Nepodařilo se vytvořit nový chat.",
        variant: "destructive"
      });
    }
  });

  // Update chat title mutation
  const updateChatMutation = useMutation({
    mutationFn: async ({ chatId, title }: { chatId: string; title: string }) => {
      console.log('Updating chat:', chatId, title);
      const response = await fetch(`/api/chats/${chatId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ title })
      });

      if (!response.ok) {
        throw new Error('Failed to update chat');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-chats'] });
      setEditingChatId(null);
      toast({
        title: "Úspěch",
        description: "Název chatu byl změněn.",
      });
    },
    onError: () => {
      toast({
        title: "Chyba",
        description: "Nepodařilo se změnit název chatu.",
        variant: "destructive"
      });
    }
  });

  // Delete chat mutation
  const deleteChatMutation = useMutation({
    mutationFn: async (chatId: string) => {
      console.log('Deleting chat:', chatId);
      const response = await fetch(`/api/chats/${chatId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error('Failed to delete chat');
      }

      return response.json();
    },
    onSuccess: (_, deletedChatId) => {
      queryClient.invalidateQueries({ queryKey: ['user-chats'] });
      // If deleted chat was selected, clear selection
      if (currentChatId === deletedChatId) {
        onNewChat();
      }
      toast({
        title: "Úspěch",
        description: "Chat byl smazán.",
      });
    },
    onError: () => {
      toast({
        title: "Chyba",
        description: "Nepodařilo se smazat chat.",
        variant: "destructive"
      });
    }
  });

  const handleNewChat = () => {
    createChatMutation.mutate();
  };

  const handleEditSubmit = (chatId: string) => {
    if (editTitle.trim()) {
      updateChatMutation.mutate({ chatId, title: editTitle.trim() });
    } else {
      setEditingChatId(null);
    }
  };

  const startEditing = (chat: Chat) => {
    setEditingChatId(chat.id);
    setEditTitle(chat.title);
  };

  const handleDelete = (chatId: string) => {
    if (confirm('Opravdu chcete smazat tento chat?')) {
      deleteChatMutation.mutate(chatId);
    }
  };

  if (error) {
    console.error('Chat sidebar error:', error);
  }

  return (
    <div className="w-64 bg-white border-r border-slate-200 flex flex-col h-screen" data-testid="chat-sidebar">
      {/* User info and new chat */}
      <div className="p-4 border-b border-slate-200">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <i className="fas fa-user-circle text-blue-600"></i>
            <span className="font-medium text-slate-700">{currentUser.username}</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onLogout}
            data-testid="button-logout"
          >
            <i className="fas fa-sign-out-alt"></i>
          </Button>
        </div>
        
        <Button
          onClick={handleNewChat}
          className="w-full"
          size="sm"
          disabled={createChatMutation.isPending}
          data-testid="button-new-chat"
        >
          <i className="fas fa-plus mr-2"></i>
          {createChatMutation.isPending ? 'Vytváří se...' : 'Nový chat'}
        </Button>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-4 text-center text-slate-500 text-sm">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent mx-auto mb-2"></div>
            Načítání chatů...
          </div>
        ) : error ? (
          <div className="p-4 text-center text-red-500 text-sm">
            {error.message.includes('Not authenticated') 
              ? 'Přihlaste se znovu' 
              : 'Chyba při načítání chatů'}
            <br />
            <Button 
              variant="outline" 
              size="sm" 
              className="mt-2"
              onClick={() => window.location.reload()}
            >
              Obnovit
            </Button>
          </div>
        ) : chats.length === 0 ? (
          <div className="p-4 text-center text-slate-500 text-sm">
            Žádné chaty k zobrazení.<br />
            Klikněte na "Nový chat" pro vytvoření.
          </div>
        ) : (
          <div className="p-2">
            {chats.map((chat, index) => (
              <div
                key={chat.id}
                className={`group p-3 rounded-lg mb-1 cursor-pointer transition-colors ${
                  currentChatId === chat.id 
                    ? 'bg-blue-50 border border-blue-200' 
                    : 'hover:bg-slate-50'
                }`}
                data-testid={`chat-item-${chat.id}`}
              >
                {editingChatId === chat.id ? (
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') {
                        handleEditSubmit(chat.id);
                      } else if (e.key === 'Escape') {
                        setEditingChatId(null);
                      }
                    }}
                    onBlur={() => handleEditSubmit(chat.id)}
                    className="text-sm"
                    autoFocus
                    data-testid={`input-edit-chat-${chat.id}`}
                  />
                ) : (
                  <div onClick={() => onChatSelect(chat.id)}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700 truncate" data-testid={`text-chat-title-${chat.id}`}>
                        {chat.title}
                      </span>
                      <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditing(chat);
                          }}
                          className="h-6 w-6 p-0"
                          data-testid={`button-edit-chat-${chat.id}`}
                        >
                          <i className="fas fa-edit text-xs"></i>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(chat.id);
                          }}
                          className="h-6 w-6 p-0"
                          data-testid={`button-delete-chat-${chat.id}`}
                        >
                          <i className="fas fa-trash text-xs"></i>
                        </Button>
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {new Date(chat.updatedAt || chat.createdAt).toLocaleString('cs-CZ')}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Debug info in development */}
      {process.env.NODE_ENV === 'development' && (
        <div className="p-2 bg-gray-100 text-xs text-gray-600 border-t">
          Chats: {chats.length} | User: {currentUser.id.slice(0, 8)}...
        </div>
      )}
    </div>
  );
}