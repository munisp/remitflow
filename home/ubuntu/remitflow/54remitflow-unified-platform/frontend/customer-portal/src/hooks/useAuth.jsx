import { useState, useEffect, createContext, useContext } from 'react';

const AuthContext = createContext(null);

const getAuthConfig = () => ({
  keycloakUrl: import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8080',
  realm: import.meta.env.VITE_KEYCLOAK_REALM || 'remittance',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'customer-portal',
  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:8111'
});

export const useAuth = () => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const config = getAuthConfig();

  useEffect(() => {
    const initAuth = async () => {
      // Check for Keycloak callback
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      
      if (code) {
        await handleKeycloakCallback(code);
        window.history.replaceState({}, document.title, window.location.pathname);
        return;
      }

      // Check for stored authentication
      const storedUser = localStorage.getItem('customer_portal_user');
      const storedToken = localStorage.getItem('customer_portal_token');
      const tokenExpiry = localStorage.getItem('customer_portal_token_expiry');
      
      if (storedUser && storedToken) {
        if (tokenExpiry && Date.now() > parseInt(tokenExpiry)) {
          const refreshed = await refreshToken();
          if (!refreshed) {
            clearAuthData();
            setIsLoading(false);
            return;
          }
        }
        
        try {
          setUser(JSON.parse(storedUser));
        } catch (error) {
          console.error('Error parsing stored user data:', error);
          clearAuthData();
        }
      }
      
      setIsLoading(false);
    };

    initAuth();
  }, []);

  const clearAuthData = () => {
    localStorage.removeItem('customer_portal_user');
    localStorage.removeItem('customer_portal_token');
    localStorage.removeItem('customer_portal_refresh_token');
    localStorage.removeItem('customer_portal_token_expiry');
  };

  const handleKeycloakCallback = async (code) => {
    try {
      setIsLoading(true);
      
      const tokenUrl = `${config.keycloakUrl}/realms/${config.realm}/protocol/openid-connect/token`;
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: config.clientId,
          code: code,
          redirect_uri: window.location.origin + window.location.pathname,
        }),
      });

      if (!response.ok) throw new Error('Failed to exchange authorization code');

      const tokenResponse = await response.json();
      await processTokenResponse(tokenResponse);
    } catch (error) {
      console.error('Keycloak callback error:', error);
      clearAuthData();
    } finally {
      setIsLoading(false);
    }
  };

  const processTokenResponse = async (tokenResponse) => {
    const { access_token, refresh_token, expires_in } = tokenResponse;
    
    const payload = JSON.parse(atob(access_token.split('.')[1]));
    
    const userData = {
      id: payload.sub,
      name: payload.name || payload.preferred_username || 'Customer',
      email: payload.email || '',
      phone: payload.phone_number || '',
      keycloakId: payload.sub,
    };

    localStorage.setItem('customer_portal_token', access_token);
    localStorage.setItem('customer_portal_refresh_token', refresh_token);
    localStorage.setItem('customer_portal_token_expiry', String(Date.now() + expires_in * 1000));
    localStorage.setItem('customer_portal_user', JSON.stringify(userData));
    
    setUser(userData);
  };

  const loginWithKeycloak = () => {
    const authUrl = `${config.keycloakUrl}/realms/${config.realm}/protocol/openid-connect/auth`;
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: window.location.origin + window.location.pathname,
      response_type: 'code',
      scope: 'openid profile email',
    });
    
    window.location.href = `${authUrl}?${params.toString()}`;
  };

  const refreshToken = async () => {
    const storedRefreshToken = localStorage.getItem('customer_portal_refresh_token');
    if (!storedRefreshToken) return false;

    try {
      const tokenUrl = `${config.keycloakUrl}/realms/${config.realm}/protocol/openid-connect/token`;
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: config.clientId,
          refresh_token: storedRefreshToken,
        }),
      });

      if (!response.ok) return false;

      const tokenResponse = await response.json();
      await processTokenResponse(tokenResponse);
      return true;
    } catch (error) {
      console.error('Token refresh failed:', error);
      return false;
    }
  };

  const login = async (credentials) => {
    try {
      setIsLoading(true);
      
      const tokenUrl = `${config.keycloakUrl}/realms/${config.realm}/protocol/openid-connect/token`;
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: config.clientId,
          username: credentials.email,
          password: credentials.password,
          scope: 'openid profile email',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error_description || 'Authentication failed');
      }

      const tokenResponse = await response.json();
      await processTokenResponse(tokenResponse);
    } catch (error) {
      console.error('Login error:', error);
      throw new Error(error.message || 'Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      setIsLoading(true);
      clearAuthData();
      setUser(null);
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    loginWithKeycloak,
    logout,
    refreshToken
  };
};

export { AuthContext };
export default useAuth;
