import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Spinner from '../components/Spinner';

// Layout
import MainLayout from '../layouts/MainLayout';

// Pages
import Login from '../pages/Login';
import Register from '../pages/Register';
import Products from '../pages/Products';
import ProductDetails from '../pages/ProductDetails';
import Orders from '../pages/Orders';
import Profile from '../pages/Profile';
import PurchaseStatus from '../pages/PurchaseStatus';
import AdminDashboard from '../pages/AdminDashboard';
import AdminProducts from '../pages/AdminProducts';
import AddEditProduct from '../pages/AddEditProduct';
import AdminInventory from '../pages/AdminInventory';
import AdminFlashSales from '../pages/AdminFlashSales';
import NotFound from '../pages/NotFound';

// Protected Route Component (Requires authentication)
export const ProtectedRoute = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return <Spinner fullPage />;
  }

  return user ? <MainLayout /> : <Navigate to="/login" replace />;
};

// Role Based Route Component (Requires authentication + specific role)
export const RoleBasedRoute = ({ allowedRoles }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <Spinner fullPage />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return allowedRoles.includes(user.role) ? (
    <MainLayout />
  ) : (
    <Navigate to="/products" replace />
  );
};

export const AppRouter = () => {
  const { user } = useAuth();

  return (
    <Routes>
      {/* Redirect root to /products or /login */}
      <Route
        path="/"
        element={<Navigate to={user ? "/products" : "/login"} replace />}
      />

      {/* Public Routes (Only if NOT authenticated) */}
      <Route
        path="/login"
        element={user ? <Navigate to="/products" replace /> : <Login />}
      />
      <Route
        path="/register"
        element={user ? <Navigate to="/products" replace /> : <Register />}
      />

      {/* Authenticated User Routes (USER and ADMIN) */}
      <Route element={<ProtectedRoute />}>
        <Route path="/products" element={<Products />} />
        <Route path="/products/:id" element={<ProductDetails />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/purchase/:reservationId/status" element={<PurchaseStatus />} />
      </Route>

      {/* Admin-Only Routes (ADMIN only) */}
      <Route element={<RoleBasedRoute allowedRoles={['ADMIN']} />}>
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/products" element={<AdminProducts />} />
        <Route path="/admin/products/new" element={<AddEditProduct />} />
        <Route path="/admin/products/:id" element={<AddEditProduct />} />
        <Route path="/admin/inventory" element={<AdminInventory />} />
        <Route path="/admin/flash-sales" element={<AdminFlashSales />} />
      </Route>

      {/* 404 Route */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default AppRouter;
