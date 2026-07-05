import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { setupInterceptors } from '../services/api';
import authApi from '../services/authApi';

const AuthContext = createContext(null);

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Decode JWT helper
const decodeToken = (token) => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const decoded = JSON.parse(jsonPayload);
    // Standard JWT claims mapping
    return {
      email: decoded.sub,
      role: decoded.role, // ADMIN / USER
      userId: decoded.userId,
      name: decoded.name,
      exp: decoded.exp,
    };
  } catch (error) {
    console.error('Failed to decode token:', error);
    return null;
  }
};

export const AuthProvider = ({ children }) => {
  const [accessToken, setAccessToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Function to perform authentication token refresh
  const refreshAuthToken = async () => {
    const storedRefreshToken = localStorage.getItem('rt_flashflow');
    if (!storedRefreshToken) {
      setLoading(false);
      return null;
    }
    try {
      const data = await authApi.refresh(storedRefreshToken);
      const { accessToken: newAccessToken, refreshToken: newRefreshToken } = data;
      
      setAccessToken(newAccessToken);
      localStorage.setItem('rt_flashflow', newRefreshToken);
      const decoded = decodeToken(newAccessToken);
      setUser(decoded);
      return newAccessToken;
    } catch (error) {
      console.error('Failed to refresh token:', error);
      // Clean up on failure
      logout();
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setupInterceptors(
      () => accessToken,
      refreshAuthToken,
      logout
    );
  }, [accessToken]);

  useEffect(() => {
    refreshAuthToken();
  }, []);

  const login = async (email, password) => {
    try {
      const data = await authApi.login(email, password);
      const { accessToken: token, refreshToken: rt } = data;
      setAccessToken(token);
      localStorage.setItem('rt_flashflow', rt);
      const decoded = decodeToken(token);
      setUser(decoded);
      return { success: true, user: decoded };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Login failed. Please check your credentials.',
      };
    }
  };

  const register = async (name, email, password) => {
    try {
      await authApi.register(name, email, password);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || 'Registration failed. Try again.',
      };
    }
  };

  const logout = async () => {
    const rt = localStorage.getItem('rt_flashflow');
    if (rt) {
      try {
        await authApi.logout(rt);
      } catch (err) {
        console.error('Logout error on server:', err);
      }
    }
    localStorage.removeItem('rt_flashflow');
    setAccessToken(null);
    setUser(null);
    setLoading(false);
  };

  return (
    <AuthContext.Provider
      value={{
        accessToken,
        user,
        loading,
        login,
        register,
        logout,
        setAccessToken,
        refreshAuthToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
