import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface LoginProps {
  onLoginSuccess: (user: { id: string; username: string }) => void;
  onContinueAsGuest: () => void;
}

export default function Login({ onLoginSuccess, onContinueAsGuest }: LoginProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { toast } = useToast();

  const authMutation = useMutation({
    mutationFn: async ({ username, password, mode }: { username: string; password: string; mode: 'login' | 'register' }) => {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ username, password })
        });

        console.log('Response status:', response.status);
        console.log('Response headers:', response.headers);

        if (!response.ok) {
          const contentType = response.headers.get('content-type');
          console.log('Content-Type:', contentType);
          
          if (contentType && contentType.includes('application/json')) {
            const error = await response.json();
            throw new Error(error.error || 'Authentication failed');
          } else {
            // Server returned HTML or other non-JSON content
            const text = await response.text();
            console.log('Non-JSON response:', text);
            throw new Error(`Server error: ${response.status}. Please check server logs.`);
          }
        }

        const result = await response.json();
        console.log('Success response:', result);
        return result;
      } catch (error) {
        console.error('Fetch error:', error);
        if (error instanceof TypeError && error.message.includes('fetch')) {
          throw new Error('Network error: Cannot connect to server');
        }
        throw error;
      }
    },
    onSuccess: (data) => {
      toast({
        title: mode === 'login' ? "Přihlášení úspěšné" : "Registrace úspěšná",
        description: `Vítejte, ${data.user.username}!`,
      });
      onLoginSuccess(data.user);
    },
    onError: (error) => {
      toast({
        title: "Chyba",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username.trim() || !password.trim()) {
      toast({
        title: "Chyba",
        description: "Prosím vyplňte všechna pole.",
        variant: "destructive"
      });
      return;
    }

    authMutation.mutate({ username: username.trim(), password, mode });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-slate-800 mb-2">
            <i className="fas fa-comments text-blue-600 mr-3"></i>
            Chat Aplikace
          </h1>
          <p className="text-slate-600">Přihlaste se nebo pokračujte jako host</p>
        </div>

        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-center">
              {mode === 'login' ? 'Přihlášení' : 'Registrace'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="username" className="text-sm font-medium">
                  Uživatelské jméno:
                </label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Zadejte uživatelské jméno"
                  disabled={authMutation.isPending}
                />
              </div>
              
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">
                  Heslo:
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Zadejte heslo"
                  disabled={authMutation.isPending}
                />
              </div>

              <Button 
                type="submit" 
                className="w-full"
                disabled={authMutation.isPending}
              >
                {authMutation.isPending 
                  ? (mode === 'login' ? 'Přihlašuji...' : 'Registruji...') 
                  : (mode === 'login' ? 'Přihlásit' : 'Registrovat')
                }
              </Button>
            </form>

            <div className="border-t pt-4">
              <Button
                variant="outline"
                onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                className="w-full mb-3"
                disabled={authMutation.isPending}
              >
                {mode === 'login' ? 'Nemáte účet? Registrujte se' : 'Máte účet? Přihlaste se'}
              </Button>

              <Button
                variant="ghost"
                onClick={onContinueAsGuest}
                className="w-full"
                disabled={authMutation.isPending}
              >
                <i className="fas fa-user-circle mr-2"></i>
                Pokračovat jako host
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}