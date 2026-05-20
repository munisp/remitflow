
import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { Home, LayoutDashboard, Settings, CreditCard, BarChart3, ArrowUp, ArrowDown, User, Bell, Search, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';

import './App.css';

// Data for charts
const monthlyData = [
  { name: 'Jan', deposits: 4000, withdrawals: 2400 },
  { name: 'Feb', deposits: 3000, withdrawals: 1398 },
  { name: 'Mar', deposits: 2000, withdrawals: 9800 },
  { name: 'Apr', deposits: 2780, withdrawals: 3908 },
  { name: 'May', deposits: 1890, withdrawals: 4800 },
  { name: 'Jun', deposits: 2390, withdrawals: 3800 },
  { name: 'Jul', deposits: 3490, withdrawals: 4300 },
];

const HomePage = () => (
  <ScrollArea className="h-[calc(100vh-120px)] p-4">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center space-x-2">
        <Avatar className="h-10 w-10">
          <AvatarImage src="https://github.com/shadcn.png" alt="@shadcn" />
          <AvatarFallback>AB</AvatarFallback>
        </Avatar>
        <div>
          <p className="text-sm font-medium">Welcome back,</p>
          <p className="text-lg font-bold">Agent John Doe</p>
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <Button variant="ghost" size="icon">
          <Bell className="h-5 w-5" />
        </Button>
        <Button variant="ghost" size="icon">
          <Search className="h-5 w-5" />
        </Button>
      </div>
    </div>

    <Card className="mb-4 bg-gradient-to-r from-blue-500 to-purple-600 text-white">
      <CardHeader>
        <CardTitle className="text-xl font-bold">Total Balance</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-4xl font-bold mb-2">$25,450.75</p>
        <div className="flex items-center justify-between text-sm">
          <span>Available Funds</span>
          <Badge variant="secondary" className="bg-white text-blue-600">+5.2% today</Badge>
        </div>
      </CardContent>
    </Card>

    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-lg">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4">
        <Button variant="outline" className="flex flex-col h-24 justify-center items-center text-blue-600 border-blue-200 hover:bg-blue-50">
          <ArrowUp className="h-6 w-6 mb-2" />
          Deposit
        </Button>
        <Button variant="outline" className="flex flex-col h-24 justify-center items-center text-red-600 border-red-200 hover:bg-red-50">
          <ArrowDown className="h-6 w-6 mb-2" />
          Withdraw
        </Button>
        <Button variant="outline" className="flex flex-col h-24 justify-center items-center">
          <CreditCard className="h-6 w-6 mb-2" />
          Transfers
        </Button>
        <Button variant="outline" className="flex flex-col h-24 justify-center items-center">
          <BarChart3 className="h-6 w-6 mb-2" />
          Reports
        </Button>
      </CardContent>
    </Card>

    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="text-lg">Recent Transactions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center">
            <Avatar className="h-9 w-9">
              <AvatarImage src="https://github.com/shadcn.png" alt="Avatar" />
              <AvatarFallback>JD</AvatarFallback>
            </Avatar>
            <div className="ml-4 space-y-1">
              <p className="text-sm font-medium leading-none">Deposit</p>
              <p className="text-sm text-muted-foreground">From: Customer A</p>
            </div>
            <div className="ml-auto font-medium text-green-600">+$500.00</div>
          </div>
          <Separator />
          <div className="flex items-center">
            <Avatar className="h-9 w-9">
              <AvatarImage src="https://github.com/shadcn.png" alt="Avatar" />
              <AvatarFallback>JS</AvatarFallback>
            </Avatar>
            <div className="ml-4 space-y-1">
              <p className="text-sm font-medium leading-none">Withdrawal</p>
              <p className="text-sm text-muted-foreground">To: Customer B</p>
            </div>
            <div className="ml-auto font-medium text-red-600">-$150.00</div>
          </div>
          <Separator />
          <div className="flex items-center">
            <Avatar className="h-9 w-9">
              <AvatarImage src="https://github.com/shadcn.png" alt="Avatar" />
              <AvatarFallback>CC</AvatarFallback>
            </Avatar>
            <div className="ml-4 space-y-1">
              <p className="text-sm font-medium leading-none">Transfer</p>
              <p className="text-sm text-muted-foreground">To: Bank Account</p>
            </div>
            <div className="ml-auto font-medium">-$200.00</div>
          </div>
        </div>
        <Button variant="link" className="w-full mt-4">View All Transactions</Button>
      </CardContent>
    </Card>
  </ScrollArea>
);

const DashboardPage = () => {
  return (
    <ScrollArea className="h-[calc(100vh-120px)] p-4">
      <h2 className="text-2xl font-bold mb-4">Dashboard Overview</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Deposits</CardTitle>
            <ArrowUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">+$15,231.89</div>
            <p className="text-xs text-muted-foreground">+20.1% from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Withdrawals</CardTitle>
            <ArrowDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">-$8,123.00</div>
            <p className="text-xs text-muted-foreground">-15.5% from last month</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Monthly Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="deposits" stroke="hsl(var(--primary))" activeDot={{ r: 8 }} />
                <Line type="monotone" dataKey="withdrawals" stroke="hsl(var(--destructive))" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Transaction Categories</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span>Deposits</span>
              <Progress value={70} className="w-[60%]" />
              <span>70%</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Withdrawals</span>
              <Progress value={45} className="w-[60%]" />
              <span>45%</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Transfers</span>
              <Progress value={25} className="w-[60%]" />
              <span>25%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Agent Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-4">
            <Avatar className="h-12 w-12">
              <AvatarImage src="https://github.com/shadcn.png" alt="Agent" />
              <AvatarFallback>AG</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-bold">Agent ID: #12345</p>
              <p className="text-sm text-muted-foreground">Last Login: 2 hours ago</p>
              <p className="text-sm text-muted-foreground">Transactions Today: 12</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </ScrollArea>
  );
};

const TransactionsPage = () => (
  <ScrollArea className="h-[calc(100vh-120px)] p-4">
    <h2 className="text-2xl font-bold mb-4">Transaction History</h2>
    <div className="mb-4">
      <Input placeholder="Search transactions..." className="w-full" />
    </div>
    <Card>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {/* Example Transaction Item */}
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-full bg-green-100 text-green-600">
                <ArrowUp className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium">Deposit from Customer C</p>
                <p className="text-sm text-muted-foreground">2023-10-26 10:30 AM</p>
              </div>
            </div>
            <div className="font-bold text-green-600">+$750.00</div>
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-full bg-red-100 text-red-600">
                <ArrowDown className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium">Withdrawal to Customer D</p>
                <p className="text-sm text-muted-foreground">2023-10-25 03:15 PM</p>
              </div>
            </div>
            <div className="font-bold text-red-600">-$300.00</div>
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-full bg-blue-100 text-blue-600">
                <CreditCard className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium">Bank Transfer Out</p>
                <p className="text-sm text-muted-foreground">2023-10-24 11:00 AM</p>
              </div>
            </div>
            <div className="font-bold text-blue-600">-$1000.00</div>
          </div>
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-full bg-green-100 text-green-600">
                <ArrowUp className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium">Deposit from Customer E</p>
                <p className="text-sm text-muted-foreground">2023-10-23 09:00 AM</p>
              </div>
            </div>
            <div className="font-bold text-green-600">+$200.00</div>
          </div>
        </div>
      </CardContent>
    </Card>
    <Button variant="link" className="w-full mt-4">Load More</Button>
  </ScrollArea>
);

const SettingsPage = () => {
  const { logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <ScrollArea className="h-[calc(100vh-120px)] p-4">
      <h2 className="text-2xl font-bold mb-4">Settings</h2>
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Profile Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center space-x-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src="https://github.com/shadcn.png" alt="Agent" />
              <AvatarFallback>JD</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-lg font-bold">John Doe</p>
              <p className="text-sm text-muted-foreground">Agent ID: #12345</p>
              <Button variant="link" className="p-0 h-auto">Edit Profile</Button>
            </div>
          </div>
          <Separator />
          <div>
            <p className="font-medium">Email</p>
            <p className="text-muted-foreground">john.doe@example.com</p>
          </div>
          <div>
            <p className="font-medium">Phone</p>
            <p className="text-muted-foreground">+1 (555) 123-4567</p>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Security</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="outline" className="w-full justify-start">Change Password</Button>
          <Button variant="outline" className="w-full justify-start">Two-Factor Authentication</Button>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>App Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="outline" className="w-full justify-start">Notification Settings</Button>
          <Button variant="outline" className="w-full justify-start">Theme (Light/Dark)</Button>
          <Button variant="outline" className="w-full justify-start text-red-600 border-red-200 hover:bg-red-50" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </CardContent>
      </Card>
    </ScrollArea>
  );
};

const PrivateRoute = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: location.pathname } });
    }
  }, [isAuthenticated, navigate, location]);

  return isAuthenticated ? children : null;
};

const Layout = ({ children }) => {
  const { isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground max-w-md mx-auto border-x border-border">
      {/* Header */}
      <header className="bg-primary text-primary-foreground p-4 flex items-center justify-between shadow-md sticky top-0 z-10">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="lg:hidden">
              <LayoutDashboard className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <div className="flex flex-col h-full">
              <div className="p-4 border-b border-border">
                <h2 className="text-xl font-bold">Remittance Platform</h2>
              </div>
              <nav className="flex flex-col p-4 space-y-2 flex-grow">
                <Link to="/" className="flex items-center space-x-3 p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors">
                  <Home className="h-5 w-5" />
                  <span>Home</span>
                </Link>
                <Link to="/dashboard" className="flex items-center space-x-3 p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors">
                  <LayoutDashboard className="h-5 w-5" />
                  <span>Dashboard</span>
                </Link>
                <Link to="/transactions" className="flex items-center space-x-3 p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors">
                  <CreditCard className="h-5 w-5" />
                  <span>Transactions</span>
                </Link>
                <Link to="/settings" className="flex items-center space-x-3 p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors">
                  <Settings className="h-5 w-5" />
                  <span>Settings</span>
                </Link>
              </nav>
              <div className="p-4 border-t border-border">
                {isAuthenticated ? (
                  <Button variant="ghost" className="w-full justify-start" onClick={handleLogout}>
                    <LogOut className="h-5 w-5 mr-2" />
                    <span>Logout</span>
                  </Button>
                ) : (
                  <Button variant="ghost" className="w-full justify-start" onClick={() => navigate('/login')}>
                    <User className="h-5 w-5 mr-2" />
                    <span>Login</span>
                  </Button>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>
        <h1 className="text-xl font-bold">Remittance Platform PWA</h1>
        {isAuthenticated ? (
          <Avatar className="h-8 w-8">
            <AvatarImage src="https://github.com/shadcn.png" alt="User Avatar" />
            <AvatarFallback>AB</AvatarFallback>
          </Avatar>
        ) : (
          <Button variant="ghost" size="icon" onClick={() => navigate('/login')}>
            <User className="h-5 w-5" />
          </Button>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-grow overflow-auto">
        {children}
      </main>

      {/* Bottom Navigation */}
      {isAuthenticated && (
        <nav className="bg-card border-t border-border p-2 fixed bottom-0 left-0 right-0 w-full max-w-md mx-auto flex justify-around items-center shadow-lg z-10">
          <Link to="/" className="flex flex-col items-center text-xs text-muted-foreground hover:text-primary transition-colors p-1">
            <Home className="h-5 w-5 mb-1" />
            Home
          </Link>
          <Link to="/dashboard" className="flex flex-col items-center text-xs text-muted-foreground hover:text-primary transition-colors p-1">
            <LayoutDashboard className="h-5 w-5 mb-1" />
            Dashboard
          </Link>
          <Link to="/transactions" className="flex flex-col items-center text-xs text-muted-foreground hover:text-primary transition-colors p-1">
            <CreditCard className="h-5 w-5 mb-1" />
            Transactions
          </Link>
          <Link to="/settings" className="flex flex-col items-center text-xs text-muted-foreground hover:text-primary transition-colors p-1">
            <Settings className="h-5 w-5 mb-1" />
            Settings
          </Link>
        </nav>
      )}
    </div>
  );
};

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <PrivateRoute>
                <Layout>
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/transactions" element={<TransactionsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                  </Routes>
                </Layout>
              </PrivateRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;

