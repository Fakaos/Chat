import { useState, useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Home from "@/pages/home";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";

interface User {
  id: string;
  username: string;
}

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Check if user is authenticated on app load
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include'
        });
        if (response.ok) {
          const data = await response.json();
          setCurrentUser(data.user);
        }
      } catch (error) {
        // Silent auth check failure
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    setIsGuest(false);
  };

  const handleContinueAsGuest = () => {
    setIsGuest(true);
    setCurrentUser(null);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
    } catch (error) {
      // Silent logout failure
    } finally {
      setCurrentUser(null);
      setIsGuest(false);
    }
  };

  if (isLoading) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <div className="min-h-screen bg-slate-50 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-600 border-t-transparent mx-auto mb-4"></div>
              <p className="text-slate-600">Načítání...</p>
            </div>
          </div>
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  // Show login page if user is not authenticated and not a guest
  if (!currentUser && !isGuest) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Login 
            onLoginSuccess={handleLoginSuccess}
            onContinueAsGuest={handleContinueAsGuest}
          />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  // Router for authenticated/guest users
  function Router() {
    return (
      <Switch>
        <Route path="/">
          <Home 
            currentUser={currentUser}
            isGuest={isGuest}
            onLogout={handleLogout}
          />
        </Route>
        <Route component={NotFound} />
      </Switch>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
