import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

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

  // Fetch user's chats
  const { data: chatsData } = useQuery({
    queryKey: ['chats'],
    queryFn: async () => {
      const response = await fetch('/api/chats');
      if (!response.ok) throw new Error('Failed to fetch chats');
      return response.json();
    },
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const chats: Chat[] = chatsData?.chats || [];

  // Update chat title mutation
  const updateChatMutation = useMutation({
    mutationFn: async ({ chatId, title }: { chatId: string; title: string }) => {
      const response = await fetch(`/api/chats/${chatId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title })
      });

      if (!response.ok) {
        throw new Error('Failed to update chat');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
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
      const response = await fetch(`/api/chats/${chatId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete chat');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
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

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/auth/logout', {
        method: 'POST'
      });
      return response.json();
    },
    onSuccess: () => {
      onLogout();
    }
  });

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

  const generateChatTitle = (chatNumber: number) => {
    return `Chat ${chatNumber}`;
  };

  return (
    <div className="w-64 bg-white border-r border-slate-200 flex flex-col h-full">
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
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
          >
            <i className="fas fa-sign-out-alt"></i>
          </Button>
        </div>
        
        <Button
          onClick={onNewChat}
          className="w-full"
          size="sm"
        >
          <i className="fas fa-plus mr-2"></i>
          Nový chat
        </Button>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto">
        {chats.length === 0 ? (
          <div className="p-4 text-center text-slate-500 text-sm">
            Žádné chaty k zobrazení
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
                  />
                ) : (
                  <div onClick={() => onChatSelect(chat.id)}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700 truncate">
                        {chat.title || generateChatTitle(index + 1)}
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
                        >
                          <i className="fas fa-edit text-xs"></i>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm('Opravdu chcete smazat tento chat?')) {
                              deleteChatMutation.mutate(chat.id);
                            }
                          }}
                          className="h-6 w-6 p-0"
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
    </div>
  );
}