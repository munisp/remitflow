
import React from 'react';
import { RouterProvider } from 'react-router-dom';
import router from './router';
import { ThemeProvider } from './components/theme-provider';
import { AuthProvider } from './context/AuthContext';
import './App.css';

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;

