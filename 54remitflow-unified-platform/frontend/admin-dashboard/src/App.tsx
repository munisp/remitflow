import React, { useState, useEffect, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery, useMutation } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toaster, toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { ErrorBoundary } from 'react-error-boundary';
import { Helmet, HelmetProvider } from 'react-helmet-async';

// UI Components
import {
  Bell,
  Settings,
  User,
  LogOut,
  Menu,
  X,
  Search,
  Filter,
  Download,
  Upload,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Home,
  Users,
  CreditCard,
  BarChart3,
  FileText,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  MapPin,
  Calendar,
  Eye,
  Edit,
  Trash2,
  Plus,
  Minus,
  Star,
  Heart,
  Share,
  MessageSquare,
  Phone,
  Mail,
  Globe,
  Lock,
  Unlock,
  Key,
  Database,
  Server,
  Cloud,
  Wifi,
  WifiOff,
  Battery,
  BatteryLow,
  Signal,
  Bluetooth,
  Headphones,
  Mic,
  MicOff,
  Camera,
  CameraOff,
  Video,
  VideoOff,
  Play,
  Pause,
  Stop,
  SkipBack,
  SkipForward,
  Volume,
  Volume1,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Move,
  Copy,
  Cut,
  Clipboard,
  Save,
  FolderOpen,
  Folder,
  File,
  FileImage,
  FileVideo,
  FileAudio,
  FileCode,
  Archive,
  Package,
  Truck,
  ShoppingCart,
  ShoppingBag,
  Gift,
  Tag,
  Bookmark,
  Flag,
  Target,
  Award,
  Trophy,
  Medal,
  Crown,
  Zap,
  Flame,
  Sun,
  Moon,
  CloudRain,
  CloudSnow,
  Wind,
  Thermometer,
  Droplets,
  Umbrella,
  Navigation,
  Compass,
  Map,
  Route,
  Car,
  Bike,
  Bus,
  Train,
  Plane,
  Ship,
  Anchor,
  Rocket,
  Satellite,
  Building,
  Building2,
  Home as HomeIcon,
  Store,
  Factory,
  Warehouse,
  School,
  Hospital,
  Church,
  TreePine,
  Flower,
  Leaf,
  Sprout,
  Apple,
  Coffee,
  Pizza,
  Utensils,
  Wine,
  Beer,
  IceCream,
  Cake,
  Cookie,
  Candy,
  Lollipop,
  Cherry,
  Grape,
  Banana,
  Orange,
  Strawberry,
  Watermelon,
  Carrot,
  Corn,
  Broccoli,
  Mushroom,
  Pepper,
  Tomato,
  Potato,
  Onion,
  Garlic,
  Ginger,
  Herb,
  Wheat,
  Rice,
  Bread,
  Croissant,
  Bagel,
  Pretzel,
  Donut,
  Muffin,
  Pancakes,
  Waffle,
  Sandwich,
  Hamburger,
  HotDog,
  Taco,
  Burrito,
  Sushi,
  Ramen,
  Soup,
  Salad,
  Steak,
  Chicken,
  Fish,
  Shrimp,
  Lobster,
  Crab,
  Oyster,
  Clam,
  Squid,
  Octopus,
  Jellyfish,
  Shark,
  Whale,
  Dolphin,
  Seal,
  Penguin,
  Polar,
  Bear,
  Lion,
  Tiger,
  Leopard,
  Cheetah,
  Elephant,
  Rhino,
  Hippo,
  Giraffe,
  Zebra,
  Horse,
  Cow,
  Pig,
  Sheep,
  Goat,
  Deer,
  Rabbit,
  Squirrel,
  Hedgehog,
  Bat,
  Mouse,
  Rat,
  Cat,
  Dog,
  Wolf,
  Fox,
  Raccoon,
  Skunk,
  Otter,
  Beaver,
  Monkey,
  Gorilla,
  Orangutan,
  Chimp,
  Sloth,
  Koala,
  Panda,
  Kangaroo,
  Platypus,
  Echidna,
  Armadillo,
  Anteater,
  Pangolin,
  Aardvark,
  Mole,
  Shrew,
  Vole,
  Lemming,
  Hamster,
  Gerbil,
  Guinea,
  Chinchilla,
  Ferret,
  Weasel,
  Mink,
  Stoat,
  Ermine,
  Polecat,
  Badger,
  Wolverine,
  Marten,
  Fisher,
  Sable,
  Lynx,
  Bobcat,
  Ocelot,
  Serval,
  Caracal,
  Margay,
  Jaguarundi,
  Puma,
  Jaguar,
  Panther,
  Snow,
  Clouded,
  Sand,
  Black,
  Spotted,
  Striped,
  White,
  Golden,
  Silver,
  Bronze,
  Copper,
  Iron,
  Steel,
  Aluminum,
  Titanium,
  Platinum,
  Palladium,
  Rhodium,
  Iridium,
  Osmium,
  Ruthenium,
  Rhenium,
  Tungsten,
  Molybdenum,
  Chromium,
  Vanadium,
  Manganese,
  Cobalt,
  Nickel,
  Zinc,
  Gallium,
  Germanium,
  Arsenic,
  Selenium,
  Bromine,
  Krypton,
  Rubidium,
  Strontium,
  Yttrium,
  Zirconium,
  Niobium,
  Technetium,
  Ruthenium as RutheniumIcon,
  Rhodium as RhodiumIcon,
  Palladium as PalladiumIcon,
  Silver as SilverIcon,
  Cadmium,
  Indium,
  Tin,
  Antimony,
  Tellurium,
  Iodine,
  Xenon,
  Cesium,
  Barium,
  Lanthanum,
  Cerium,
  Praseodymium,
  Neodymium,
  Promethium,
  Samarium,
  Europium,
  Gadolinium,
  Terbium,
  Dysprosium,
  Holmium,
  Erbium,
  Thulium,
  Ytterbium,
  Lutetium,
  Hafnium,
  Tantalum,
  Tungsten as TungstenIcon,
  Rhenium as RheniumIcon,
  Osmium as OsmiumIcon,
  Iridium as IridiumIcon,
  Platinum as PlatinumIcon,
  Gold,
  Mercury,
  Thallium,
  Lead,
  Bismuth,
  Polonium,
  Astatine,
  Radon,
  Francium,
  Radium,
  Actinium,
  Thorium,
  Protactinium,
  Uranium,
  Neptunium,
  Plutonium,
  Americium,
  Curium,
  Berkelium,
  Californium,
  Einsteinium,
  Fermium,
  Mendelevium,
  Nobelium,
  Lawrencium,
  Rutherfordium,
  Dubnium,
  Seaborgium,
  Bohrium,
  Hassium,
  Meitnerium,
  Darmstadtium,
  Roentgenium,
  Copernicium,
  Nihonium,
  Flerovium,
  Moscovium,
  Livermorium,
  Tennessine,
  Oganesson
} from 'lucide-react';

// Lazy loaded components
const Dashboard = lazy(() => import('./components/Dashboard/Dashboard'));
const UserManagement = lazy(() => import('./components/Users/UserManagement'));
const TransactionManagement = lazy(() => import('./components/Transactions/TransactionManagement'));
const ReportsAnalytics = lazy(() => import('./components/Reports/ReportsAnalytics'));
const ComplianceMonitoring = lazy(() => import('./components/Compliance/ComplianceMonitoring'));
const SecurityCenter = lazy(() => import('./components/Security/SecurityCenter'));
const SystemSettings = lazy(() => import('./components/Settings/SystemSettings'));
const NotificationCenter = lazy(() => import('./components/Notifications/NotificationCenter'));
const AuditLogs = lazy(() => import('./components/Audit/AuditLogs'));
const PerformanceMonitoring = lazy(() => import('./components/Monitoring/PerformanceMonitoring'));

// Types
interface User {
  id: string;
  name: string;
  email: string;
  role: 'super_admin' | 'admin' | 'manager' | 'operator';
  avatar?: string;
  permissions: string[];
  lastLogin: Date;
  status: 'active' | 'inactive' | 'suspended';
}

interface NavigationItem {
  id: string;
  label: string;
  icon: React.ComponentType<any>;
  path: string;
  badge?: number;
  children?: NavigationItem[];
  permissions?: string[];
}

interface SystemStats {
  totalUsers: number;
  activeAgents: number;
  totalTransactions: number;
  transactionVolume: number;
  systemHealth: 'healthy' | 'warning' | 'critical';
  uptime: number;
  lastUpdate: Date;
}

interface NotificationItem {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  actionUrl?: string;
}

// Create Query Client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      cacheTime: 10 * 60 * 1000, // 10 minutes
      retry: 3,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
});

// Navigation Configuration
const navigationItems: NavigationItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: Home,
    path: '/dashboard',
    permissions: ['dashboard.view'],
  },
  {
    id: 'users',
    label: 'User Management',
    icon: Users,
    path: '/users',
    permissions: ['users.view'],
    children: [
      {
        id: 'users-list',
        label: 'All Users',
        icon: Users,
        path: '/users/list',
        permissions: ['users.view'],
      },
      {
        id: 'users-agents',
        label: 'Agents',
        icon: User,
        path: '/users/agents',
        permissions: ['agents.view'],
      },
      {
        id: 'users-customers',
        label: 'Customers',
        icon: User,
        path: '/users/customers',
        permissions: ['customers.view'],
      },
      {
        id: 'users-roles',
        label: 'Roles & Permissions',
        icon: Shield,
        path: '/users/roles',
        permissions: ['roles.view'],
      },
    ],
  },
  {
    id: 'transactions',
    label: 'Transactions',
    icon: CreditCard,
    path: '/transactions',
    permissions: ['transactions.view'],
    children: [
      {
        id: 'transactions-all',
        label: 'All Transactions',
        icon: CreditCard,
        path: '/transactions/all',
        permissions: ['transactions.view'],
      },
      {
        id: 'transactions-pending',
        label: 'Pending',
        icon: Clock,
        path: '/transactions/pending',
        badge: 15,
        permissions: ['transactions.view'],
      },
      {
        id: 'transactions-failed',
        label: 'Failed',
        icon: XCircle,
        path: '/transactions/failed',
        badge: 3,
        permissions: ['transactions.view'],
      },
      {
        id: 'transactions-disputes',
        label: 'Disputes',
        icon: AlertTriangle,
        path: '/transactions/disputes',
        badge: 7,
        permissions: ['disputes.view'],
      },
    ],
  },
  {
    id: 'analytics',
    label: 'Analytics & Reports',
    icon: BarChart3,
    path: '/analytics',
    permissions: ['analytics.view'],
    children: [
      {
        id: 'analytics-dashboard',
        label: 'Analytics Dashboard',
        icon: BarChart3,
        path: '/analytics/dashboard',
        permissions: ['analytics.view'],
      },
      {
        id: 'analytics-financial',
        label: 'Financial Reports',
        icon: DollarSign,
        path: '/analytics/financial',
        permissions: ['reports.financial'],
      },
      {
        id: 'analytics-operational',
        label: 'Operational Reports',
        icon: Activity,
        path: '/analytics/operational',
        permissions: ['reports.operational'],
      },
      {
        id: 'analytics-compliance',
        label: 'Compliance Reports',
        icon: FileText,
        path: '/analytics/compliance',
        permissions: ['reports.compliance'],
      },
    ],
  },
  {
    id: 'compliance',
    label: 'Compliance',
    icon: Shield,
    path: '/compliance',
    permissions: ['compliance.view'],
    children: [
      {
        id: 'compliance-kyc',
        label: 'KYC Management',
        icon: User,
        path: '/compliance/kyc',
        permissions: ['kyc.view'],
      },
      {
        id: 'compliance-aml',
        label: 'AML Monitoring',
        icon: AlertTriangle,
        path: '/compliance/aml',
        permissions: ['aml.view'],
      },
      {
        id: 'compliance-sanctions',
        label: 'Sanctions Screening',
        icon: Shield,
        path: '/compliance/sanctions',
        permissions: ['sanctions.view'],
      },
      {
        id: 'compliance-audit',
        label: 'Audit Trail',
        icon: FileText,
        path: '/compliance/audit',
        permissions: ['audit.view'],
      },
    ],
  },
  {
    id: 'security',
    label: 'Security Center',
    icon: Lock,
    path: '/security',
    permissions: ['security.view'],
    children: [
      {
        id: 'security-threats',
        label: 'Threat Detection',
        icon: AlertTriangle,
        path: '/security/threats',
        permissions: ['security.threats'],
      },
      {
        id: 'security-fraud',
        label: 'Fraud Prevention',
        icon: Shield,
        path: '/security/fraud',
        permissions: ['security.fraud'],
      },
      {
        id: 'security-access',
        label: 'Access Control',
        icon: Key,
        path: '/security/access',
        permissions: ['security.access'],
      },
      {
        id: 'security-incidents',
        label: 'Security Incidents',
        icon: AlertTriangle,
        path: '/security/incidents',
        badge: 2,
        permissions: ['security.incidents'],
      },
    ],
  },
  {
    id: 'monitoring',
    label: 'System Monitoring',
    icon: Activity,
    path: '/monitoring',
    permissions: ['monitoring.view'],
    children: [
      {
        id: 'monitoring-performance',
        label: 'Performance',
        icon: TrendingUp,
        path: '/monitoring/performance',
        permissions: ['monitoring.performance'],
      },
      {
        id: 'monitoring-health',
        label: 'System Health',
        icon: Heart,
        path: '/monitoring/health',
        permissions: ['monitoring.health'],
      },
      {
        id: 'monitoring-logs',
        label: 'System Logs',
        icon: FileText,
        path: '/monitoring/logs',
        permissions: ['monitoring.logs'],
      },
      {
        id: 'monitoring-alerts',
        label: 'Alerts',
        icon: Bell,
        path: '/monitoring/alerts',
        badge: 5,
        permissions: ['monitoring.alerts'],
      },
    ],
  },
  {
    id: 'settings',
    label: 'System Settings',
    icon: Settings,
    path: '/settings',
    permissions: ['settings.view'],
    children: [
      {
        id: 'settings-general',
        label: 'General Settings',
        icon: Settings,
        path: '/settings/general',
        permissions: ['settings.general'],
      },
      {
        id: 'settings-banking',
        label: 'Banking Configuration',
        icon: Building,
        path: '/settings/banking',
        permissions: ['settings.banking'],
      },
      {
        id: 'settings-integrations',
        label: 'Integrations',
        icon: Globe,
        path: '/settings/integrations',
        permissions: ['settings.integrations'],
      },
      {
        id: 'settings-notifications',
        label: 'Notifications',
        icon: Bell,
        path: '/settings/notifications',
        permissions: ['settings.notifications'],
      },
    ],
  },
];

// Mock API functions
const api = {
  getCurrentUser: async (): Promise<User> => {
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    return {
      id: '1',
      name: 'Adebayo Ogundimu',
      email: 'adebayo.ogundimu@remittance-platform.ng',
      role: 'super_admin',
      avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=face',
      permissions: [
        'dashboard.view',
        'users.view',
        'users.create',
        'users.edit',
        'users.delete',
        'agents.view',
        'customers.view',
        'roles.view',
        'transactions.view',
        'disputes.view',
        'analytics.view',
        'reports.financial',
        'reports.operational',
        'reports.compliance',
        'compliance.view',
        'kyc.view',
        'aml.view',
        'sanctions.view',
        'audit.view',
        'security.view',
        'security.threats',
        'security.fraud',
        'security.access',
        'security.incidents',
        'monitoring.view',
        'monitoring.performance',
        'monitoring.health',
        'monitoring.logs',
        'monitoring.alerts',
        'settings.view',
        'settings.general',
        'settings.banking',
        'settings.integrations',
        'settings.notifications',
      ],
      lastLogin: new Date(),
      status: 'active',
    };
  },

  getSystemStats: async (): Promise<SystemStats> => {
    await new Promise(resolve => setTimeout(resolve, 800));
    return {
      totalUsers: 125847,
      activeAgents: 8934,
      totalTransactions: 2847593,
      transactionVolume: 45678923456.78,
      systemHealth: 'healthy',
      uptime: 99.97,
      lastUpdate: new Date(),
    };
  },

  getNotifications: async (): Promise<NotificationItem[]> => {
    await new Promise(resolve => setTimeout(resolve, 600));
    return [
      {
        id: '1',
        type: 'warning',
        title: 'High Transaction Volume',
        message: 'Transaction volume has increased by 45% in the last hour',
        timestamp: new Date(Date.now() - 5 * 60 * 1000),
        read: false,
        actionUrl: '/monitoring/performance',
      },
      {
        id: '2',
        type: 'error',
        title: 'Security Alert',
        message: 'Multiple failed login attempts detected from IP 192.168.1.100',
        timestamp: new Date(Date.now() - 15 * 60 * 1000),
        read: false,
        actionUrl: '/security/incidents',
      },
      {
        id: '3',
        type: 'info',
        title: 'System Maintenance',
        message: 'Scheduled maintenance window starts at 2:00 AM WAT',
        timestamp: new Date(Date.now() - 30 * 60 * 1000),
        read: true,
      },
      {
        id: '4',
        type: 'success',
        title: 'Backup Completed',
        message: 'Daily system backup completed successfully',
        timestamp: new Date(Date.now() - 60 * 60 * 1000),
        read: true,
      },
      {
        id: '5',
        type: 'warning',
        title: 'KYC Documents Pending',
        message: '23 KYC documents require review',
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
        read: false,
        actionUrl: '/compliance/kyc',
      },
    ];
  },

  logout: async (): Promise<void> => {
    await new Promise(resolve => setTimeout(resolve, 500));
    // Clear authentication tokens, etc.
  },
};

// Custom Hooks
const useAuth = () => {
  const { data: user, isLoading, error } = useQuery({
    queryKey: ['currentUser'],
    queryFn: api.getCurrentUser,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  const logoutMutation = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear();
      toast.success('Logged out successfully');
      // Redirect to login page
      window.location.href = '/login';
    },
    onError: () => {
      toast.error('Logout failed');
    },
  });

  const hasPermission = (permission: string): boolean => {
    return user?.permissions.includes(permission) || false;
  };

  const hasAnyPermission = (permissions: string[]): boolean => {
    return permissions.some(permission => hasPermission(permission));
  };

  return {
    user,
    isLoading,
    error,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isLoading,
    hasPermission,
    hasAnyPermission,
  };
};

const useSystemStats = () => {
  return useQuery({
    queryKey: ['systemStats'],
    queryFn: api.getSystemStats,
    refetchInterval: 30 * 1000, // Refetch every 30 seconds
  });
};

const useNotifications = () => {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: api.getNotifications,
    refetchInterval: 60 * 1000, // Refetch every minute
  });
};

// Components
const LoadingSpinner: React.FC = () => (
  <div className="flex items-center justify-center min-h-screen">
    <motion.div
      className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full"
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
    />
  </div>
);

const ErrorFallback: React.FC<{ error: Error; resetErrorBoundary: () => void }> = ({
  error,
  resetErrorBoundary,
}) => (
  <div className="flex items-center justify-center min-h-screen bg-gray-50">
    <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6">
      <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full mb-4">
        <AlertTriangle className="w-6 h-6 text-red-600" />
      </div>
      <h2 className="text-xl font-semibold text-gray-900 text-center mb-2">
        Something went wrong
      </h2>
      <p className="text-gray-600 text-center mb-4">
        {error.message || 'An unexpected error occurred'}
      </p>
      <button
        onClick={resetErrorBoundary}
        className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors"
      >
        Try again
      </button>
    </div>
  </div>
);

const Header: React.FC<{
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}> = ({ sidebarOpen, setSidebarOpen }) => {
  const { user, logout, isLoggingOut } = useAuth();
  const { data: notifications } = useNotifications();
  const [notificationsPanelOpen, setNotificationsPanelOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const unreadCount = notifications?.filter(n => !n.read).length || 0;

  return (
    <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 lg:hidden"
          >
            {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
          
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
              <Building className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Remittance Platform</h1>
              <p className="text-xs text-gray-500">Admin Dashboard</p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {/* Search */}
          <div className="hidden md:flex items-center space-x-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search..."
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => setNotificationsPanelOpen(!notificationsPanelOpen)}
              className="p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 relative"
            >
              <Bell className="w-6 h-6" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {/* Notifications Panel */}
            <AnimatePresence>
              {notificationsPanelOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50"
                >
                  <div className="p-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {notifications?.map((notification) => (
                      <div
                        key={notification.id}
                        className={`p-4 border-b border-gray-100 hover:bg-gray-50 ${
                          !notification.read ? 'bg-blue-50' : ''
                        }`}
                      >
                        <div className="flex items-start space-x-3">
                          <div className={`w-2 h-2 rounded-full mt-2 ${
                            notification.type === 'error' ? 'bg-red-500' :
                            notification.type === 'warning' ? 'bg-yellow-500' :
                            notification.type === 'success' ? 'bg-green-500' :
                            'bg-blue-500'
                          }`} />
                          <div className="flex-1">
                            <h4 className="text-sm font-medium text-gray-900">
                              {notification.title}
                            </h4>
                            <p className="text-sm text-gray-600 mt-1">
                              {notification.message}
                            </p>
                            <p className="text-xs text-gray-400 mt-2">
                              {notification.timestamp.toLocaleTimeString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="p-4 border-t border-gray-200">
                    <button className="text-sm text-blue-600 hover:text-blue-800">
                      View all notifications
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* User Menu */}
          <div className="relative">
            <button
              onClick={() => setUserMenuOpen(!userMenuOpen)}
              className="flex items-center space-x-2 p-2 rounded-md hover:bg-gray-100"
            >
              <img
                src={user?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.name || 'User')}&background=3B82F6&color=fff`}
                alt={user?.name}
                className="w-8 h-8 rounded-full"
              />
              <div className="hidden md:block text-left">
                <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                <p className="text-xs text-gray-500 capitalize">{user?.role?.replace('_', ' ')}</p>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-600" />
            </button>

            {/* User Menu Dropdown */}
            <AnimatePresence>
              {userMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-50"
                >
                  <div className="p-4 border-b border-gray-200">
                    <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                    <p className="text-xs text-gray-500">{user?.email}</p>
                  </div>
                  <div className="py-2">
                    <button className="flex items-center space-x-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                      <User className="w-4 h-4" />
                      <span>Profile</span>
                    </button>
                    <button className="flex items-center space-x-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                      <Settings className="w-4 h-4" />
                      <span>Settings</span>
                    </button>
                    <hr className="my-2" />
                    <button
                      onClick={() => logout()}
                      disabled={isLoggingOut}
                      className="flex items-center space-x-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>{isLoggingOut ? 'Logging out...' : 'Logout'}</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
};

const Sidebar: React.FC<{
  open: boolean;
  setOpen: (open: boolean) => void;
}> = ({ open, setOpen }) => {
  const location = useLocation();
  const { hasAnyPermission } = useAuth();
  const [expandedItems, setExpandedItems] = useState<string[]>(['dashboard']);

  const toggleExpanded = (itemId: string) => {
    setExpandedItems(prev =>
      prev.includes(itemId)
        ? prev.filter(id => id !== itemId)
        : [...prev, itemId]
    );
  };

  const renderNavigationItem = (item: NavigationItem, level: number = 0) => {
    if (item.permissions && !hasAnyPermission(item.permissions)) {
      return null;
    }

    const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
    const isExpanded = expandedItems.includes(item.id);
    const hasChildren = item.children && item.children.length > 0;

    return (
      <div key={item.id}>
        <div
          className={`flex items-center justify-between px-4 py-2 text-sm rounded-md cursor-pointer transition-colors ${
            level > 0 ? 'ml-4' : ''
          } ${
            isActive
              ? 'bg-blue-100 text-blue-700 border-r-2 border-blue-600'
              : 'text-gray-700 hover:bg-gray-100'
          }`}
          onClick={() => {
            if (hasChildren) {
              toggleExpanded(item.id);
            } else {
              // Navigate to the route
              window.history.pushState({}, '', item.path);
              setOpen(false); // Close sidebar on mobile
            }
          }}
        >
          <div className="flex items-center space-x-3">
            <item.icon className={`w-5 h-5 ${isActive ? 'text-blue-600' : 'text-gray-500'}`} />
            <span className="font-medium">{item.label}</span>
            {item.badge && (
              <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full">
                {item.badge}
              </span>
            )}
          </div>
          {hasChildren && (
            <ChevronRight
              className={`w-4 h-4 transition-transform ${
                isExpanded ? 'transform rotate-90' : ''
              }`}
            />
          )}
        </div>

        {hasChildren && isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {item.children?.map(child => renderNavigationItem(child, level + 1))}
          </motion.div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Mobile Overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{
          x: open ? 0 : -320,
        }}
        className="fixed left-0 top-0 h-full w-80 bg-white shadow-lg z-50 lg:relative lg:translate-x-0 lg:shadow-none lg:border-r lg:border-gray-200"
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center space-x-3 p-6 border-b border-gray-200">
            <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
              <Building className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Remittance Platform</h2>
              <p className="text-sm text-gray-500">Admin Dashboard</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-4 space-y-2">
            {navigationItems.map(item => renderNavigationItem(item))}
          </nav>

          {/* Footer */}
          <div className="p-4 border-t border-gray-200">
            <div className="text-xs text-gray-500 text-center">
              <p>Remittance Platform v2.0</p>
              <p>© 2024 All rights reserved</p>
            </div>
          </div>
        </div>
      </motion.aside>
    </>
  );
};

const PageTransition: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.2 }}
      className="h-full"
    >
      {children}
    </motion.div>
  );
};

const AppLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar open={sidebarOpen} setOpen={setSidebarOpen} />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />
        
        <main className="flex-1 overflow-y-auto">
          <div className="p-6">
            <Suspense fallback={<LoadingSpinner />}>
              <AnimatePresence mode="wait">
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route
                    path="/dashboard"
                    element={
                      <PageTransition>
                        <Dashboard />
                      </PageTransition>
                    }
                  />
                  <Route
                    path="/users/*"
                    element={
                      <PageTransition>
                        <UserManagement />
                      </PageTransition>
                    }
                  />
                  <Route
                    path="/transactions/*"
                    element={
                      <PageTransition>
                        <TransactionManagement />
                      </PageTransition>
                    }
                  />
                  <Route
                    path="/analytics/*"
                    element={
                      <PageTransition>
                        <ReportsAnalytics />
                      </PageTransition>
                    }
                  />
                  <Route
                    path="/compliance/*"
                    element={
                      <PageTransition>
                        <ComplianceMonitoring />
                      </PageTransition>
                    }
                  />
                  <Route
                    path="/security/*"
                    element={
                      <PageTransition>
                        <SecurityCenter />
                      </PageTransition>
                    }
                  />
                  <Route
                    path="/monitoring/*"
                    element={
                      <PageTransition>
                        <PerformanceMonitoring />
                      </PageTransition>
                    }
                  />
                  <Route
                    path="/settings/*"
                    element={
                      <PageTransition>
                        <SystemSettings />
                      </PageTransition>
                    }
                  />
                  <Route
                    path="/notifications"
                    element={
                      <PageTransition>
                        <NotificationCenter />
                      </PageTransition>
                    }
                  />
                  <Route
                    path="/audit"
                    element={
                      <PageTransition>
                        <AuditLogs />
                      </PageTransition>
                    }
                  />
                  <Route
                    path="*"
                    element={
                      <div className="flex items-center justify-center h-full">
                        <div className="text-center">
                          <h2 className="text-2xl font-bold text-gray-900 mb-2">Page Not Found</h2>
                          <p className="text-gray-600">The page you're looking for doesn't exist.</p>
                        </div>
                      </div>
                    }
                  />
                </Routes>
              </AnimatePresence>
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <Router>
            <Helmet>
              <title>Remittance Platform - Admin Dashboard</title>
              <meta name="description" content="Comprehensive admin dashboard for Remittance Platform operations in Nigeria" />
              <meta name="keywords" content="remittance, nigeria, fintech, admin dashboard, banking operations" />
              <meta name="viewport" content="width=device-width, initial-scale=1.0" />
              <link rel="icon" type="image/x-icon" href="/favicon.ico" />
            </Helmet>
            
            <AppLayout />
            
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 4000,
                style: {
                  background: '#363636',
                  color: '#fff',
                },
                success: {
                  duration: 3000,
                  iconTheme: {
                    primary: '#10B981',
                    secondary: '#fff',
                  },
                },
                error: {
                  duration: 5000,
                  iconTheme: {
                    primary: '#EF4444',
                    secondary: '#fff',
                  },
                },
              }}
            />
          </Router>
        </ErrorBoundary>
        
        {process.env.NODE_ENV === 'development' && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </HelmetProvider>
  );
};

export default App;

