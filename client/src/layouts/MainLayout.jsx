import React, { useState } from 'react';
import { NavLink, useNavigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LogOut, Menu, X, Zap, ShoppingBag, ClipboardList, Shield, User } from 'lucide-react';

export const MainLayout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navItems = [
    { label: 'Products', path: '/products', icon: ShoppingBag, roles: ['USER', 'ADMIN'] },
    { label: 'Orders', path: '/orders', icon: ClipboardList, roles: ['USER', 'ADMIN'] },
    { label: 'Admin', path: '/admin', icon: Shield, roles: ['ADMIN'] },
    { label: 'Profile', path: '/profile', icon: User, roles: ['USER', 'ADMIN'] },
  ];

  const filteredItems = navItems.filter((item) => item.roles.includes(user?.role));

  const linkClass = ({ isActive }) =>
    `inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors ${
      isActive
        ? 'border-blue-600 text-blue-600'
        : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
    }`;

  const mobileLinkClass = ({ isActive }) =>
    `block pl-3 pr-4 py-2 border-l-4 text-base font-medium transition-colors ${
      isActive
        ? 'bg-blue-50 border-blue-500 text-blue-700'
        : 'border-transparent text-slate-500 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-700'
    }`;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Navbar */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            {/* Logo Section */}
            <div className="flex">
              <div className="flex-shrink-0 flex items-center cursor-pointer" onClick={() => navigate('/products')}>
                <Zap className="h-6 w-6 text-blue-600 fill-blue-600 mr-2" />
                <span className="text-xl font-bold tracking-tight text-slate-900">
                  Flash<span className="text-blue-600">Flow</span>
                </span>
              </div>
              
              {/* Desktop Menu Links */}
              <div className="hidden sm:ml-8 sm:flex sm:space-x-8">
                {filteredItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink key={item.path} to={item.path} className={linkClass}>
                      <Icon className="h-4 w-4 mr-1.5" />
                      {item.label}
                    </NavLink>
                  );
                })}
              </div>
            </div>

            {/* User Profile & Logout section (Desktop) */}
            <div className="hidden sm:ml-6 sm:flex sm:items-center sm:space-x-4">
              <div className="flex flex-col items-end">
                <span className="text-sm font-semibold text-slate-700">{user?.name || 'User'}</span>
                <span className="text-xs text-slate-500 capitalize">{user?.role?.toLowerCase()}</span>
              </div>
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
                title="Logout"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>

            {/* Mobile menu button */}
            <div className="-mr-2 flex items-center sm:hidden">
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="inline-flex items-center justify-center p-2 rounded-md text-slate-400 hover:text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
              >
                {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu Panel */}
        {isMenuOpen && (
          <div className="sm:hidden border-b border-slate-200 bg-white">
            <div className="pt-2 pb-3 space-y-1">
              {filteredItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={mobileLinkClass}
                  onClick={() => setIsMenuOpen(false)}
                >
                  <div className="flex items-center">
                    <item.icon className="h-5 w-5 mr-3 text-slate-400" />
                    {item.label}
                  </div>
                </NavLink>
              ))}
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  handleLogout();
                }}
                className="w-full text-left block pl-3 pr-4 py-2 border-l-4 border-transparent text-base font-medium text-slate-500 hover:bg-red-50 hover:border-red-500 hover:text-red-700 transition-colors"
              >
                <div className="flex items-center">
                  <LogOut className="h-5 w-5 mr-3 text-slate-400" />
                  Logout
                </div>
              </button>
            </div>
            
            {/* Mobile User Section */}
            <div className="pt-4 pb-3 border-t border-slate-200 bg-slate-50 px-4 flex items-center space-x-3">
              <div className="flex-shrink-0">
                <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold uppercase">
                  {user?.name?.[0] || 'U'}
                </div>
              </div>
              <div>
                <div className="text-base font-semibold text-slate-800">{user?.name}</div>
                <div className="text-sm font-medium text-slate-500">{user?.email}</div>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Main Page Area */}
      <main className="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      {/* Simple minimal footer */}
      <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-400">
        &copy; {new Date().getFullYear()} FlashFlow. System Admin &amp; Checkout Demonstration.
      </footer>
    </div>
  );
};

export default MainLayout;
