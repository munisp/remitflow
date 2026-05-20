/**
 * Keycloak React Integration
 * Provides authentication context and hooks for React frontend
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import Keycloak from 'keycloak-js';

// Keycloak configuration
const keycloakConfig = {
  url: process.env.REACT_APP_KEYCLOAK_URL || 'http://localhost:8080',
  realm: process.env.REACT_APP_KEYCLOAK_REALM || 'remittance',
  clientId: process.env.REACT_APP_KEYCLOAK_CLIENT_ID || 'remittance-frontend',
};

// Initialize Keycloak instance
const keycloak = new Keycloak(keycloakConfig);

// Authentication context interface
interface AuthContextType {
  keycloak: Keycloak | null;
  authenticated: boolean;
  initialized: boolean;
  user: User | null;
  token: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  register: () => Promise<void>;
  updateToken: (minValidity?: number) => Promise<boolean>;
  hasRole: (role: string) => boolean;
  hasRealmRole: (role: string) => boolean;
  hasResourceRole: (role: string, resource: string) => boolean;
}

interface User {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roles: string[];
  attributes?: Record<string, any>;
}

// Create authentication context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Keycloak provider props
interface KeycloakProviderProps {
  children: React.ReactNode;
  onTokenExpired?: () => void;
  onAuthError?: (error: any) => void;
  onAuthSuccess?: () => void;
  onAuthLogout?: () => void;
  onAuthRefreshError?: () => void;
  minValidity?: number;
}

/**
 * Keycloak Provider Component
 * Wraps the application and provides authentication context
 */
export const KeycloakProvider: React.FC<KeycloakProviderProps> = ({
  children,
  onTokenExpired,
  onAuthError,
  onAuthSuccess,
  onAuthLogout,
  onAuthRefreshError,
  minValidity = 30,
}) => {
  const [authenticated, setAuthenticated] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Initialize Keycloak
  useEffect(() => {
    keycloak
      .init({
        onLoad: 'check-sso',
        silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
        pkceMethod: 'S256',
        checkLoginIframe: true,
        checkLoginIframeInterval: 5,
      })
      .then((auth) => {
        setAuthenticated(auth);
        setInitialized(true);

        if (auth) {
          loadUserProfile();
          setToken(keycloak.token || null);
          onAuthSuccess?.();
        }
      })
      .catch((error) => {
        console.error('Keycloak initialization failed:', error);
        setInitialized(true);
        onAuthError?.(error);
      });

    // Set up event listeners
    keycloak.onTokenExpired = () => {
      console.log('Token expired');
      updateToken(minValidity);
      onTokenExpired?.();
    };

    keycloak.onAuthError = (error) => {
      console.error('Auth error:', error);
      onAuthError?.(error);
    };

    keycloak.onAuthLogout = () => {
      console.log('Auth logout');
      setAuthenticated(false);
      setUser(null);
      setToken(null);
      onAuthLogout?.();
    };

    keycloak.onAuthRefreshError = () => {
      console.error('Auth refresh error');
      onAuthRefreshError?.();
    };

    // Set up token refresh interval
    const refreshInterval = setInterval(() => {
      if (keycloak.authenticated) {
        updateToken(minValidity);
      }
    }, 60000); // Refresh every minute

    return () => {
      clearInterval(refreshInterval);
    };
  }, []);

  // Load user profile
  const loadUserProfile = useCallback(async () => {
    try {
      const profile = await keycloak.loadUserProfile();
      const roles = keycloak.realmAccess?.roles || [];

      setUser({
        id: profile.id || '',
        username: profile.username || '',
        email: profile.email || '',
        firstName: profile.firstName,
        lastName: profile.lastName,
        roles,
        attributes: profile.attributes,
      });
    } catch (error) {
      console.error('Failed to load user profile:', error);
    }
  }, []);

  // Login function
  const login = useCallback(async () => {
    try {
      await keycloak.login({
        redirectUri: window.location.origin,
      });
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  }, []);

  // Logout function
  const logout = useCallback(async () => {
    try {
      await keycloak.logout({
        redirectUri: window.location.origin,
      });
    } catch (error) {
      console.error('Logout failed:', error);
      throw error;
    }
  }, []);

  // Register function
  const register = useCallback(async () => {
    try:
      await keycloak.register({
        redirectUri: window.location.origin,
      });
    } catch (error) {
      console.error('Registration failed:', error);
      throw error;
    }
  }, []);

  // Update token function
  const updateToken = useCallback(async (minValidity: number = 30): Promise<boolean> => {
    try {
      const refreshed = await keycloak.updateToken(minValidity);
      if (refreshed) {
        setToken(keycloak.token || null);
        console.log('Token refreshed');
      }
      return refreshed;
    } catch (error) {
      console.error('Failed to refresh token:', error);
      return false;
    }
  }, []);

  // Check if user has specific role
  const hasRole = useCallback((role: string): boolean => {
    return keycloak.hasRealmRole(role);
  }, []);

  // Check if user has realm role
  const hasRealmRole = useCallback((role: string): boolean => {
    return keycloak.hasRealmRole(role);
  }, []);

  // Check if user has resource role
  const hasResourceRole = useCallback((role: string, resource: string): boolean => {
    return keycloak.hasResourceRole(role, resource);
  }, []);

  const value: AuthContextType = {
    keycloak,
    authenticated,
    initialized,
    user,
    token,
    login,
    logout,
    register,
    updateToken,
    hasRole,
    hasRealmRole,
    hasResourceRole,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * useAuth Hook
 * Provides access to authentication context
 */
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within a KeycloakProvider');
  }
  return context;
};

/**
 * ProtectedRoute Component
 * Protects routes that require authentication
 */
interface ProtectedRouteProps {
  children: React.ReactNode;
  roles?: string[];
  fallback?: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  roles,
  fallback = <div>Unauthorized</div>,
}) => {
  const { authenticated, initialized, hasRole } = useAuth();

  if (!initialized) {
    return <div>Loading...</div>;
  }

  if (!authenticated) {
    return <div>Please login to access this page</div>;
  }

  if (roles && roles.length > 0) {
    const hasRequiredRole = roles.some((role) => hasRole(role));
    if (!hasRequiredRole) {
      return <>{fallback}</>;
    }
  }

  return <>{children}</>;
};

/**
 * useKeycloakToken Hook
 * Provides access to Keycloak token with automatic refresh
 */
export const useKeycloakToken = () => {
  const { token, updateToken } = useAuth();

  useEffect(() => {
    const interval = setInterval(() => {
      updateToken(30);
    }, 60000);

    return () => clearInterval(interval);
  }, [updateToken]);

  return token;
};

/**
 * HTTP Client with Keycloak Authentication
 * Axios instance configured with Keycloak token
 */
import axios from 'axios';

export const createAuthenticatedClient = (baseURL: string) => {
  const client = axios.create({
    baseURL,
  });

  // Request interceptor to add token
  client.interceptors.request.use(
    async (config) => {
      const token = keycloak.token;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    },
    (error) => {
      return Promise.reject(error);
    }
  );

  // Response interceptor to handle token refresh
  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config;

      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;

        try {
          await keycloak.updateToken(30);
          originalRequest.headers.Authorization = `Bearer ${keycloak.token}`;
          return client(originalRequest);
        } catch (refreshError) {
          console.error('Token refresh failed:', refreshError);
          await keycloak.logout();
          return Promise.reject(refreshError);
        }
      }

      return Promise.reject(error);
    }
  );

  return client;
};

export default KeycloakProvider;

