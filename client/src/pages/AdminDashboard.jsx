import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import productApi from '../services/productApi';
import adminApi from '../services/adminApi';
import inventoryApi from '../services/inventoryApi';
import Card, { CardBody, CardHeader } from '../components/Card';
import Spinner from '../components/Spinner';
import Button from '../components/Button';
import {
  ShoppingBag,
  ClipboardList,
  Calendar,
  DollarSign,
  Package,
  ArrowRight,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { toast } from 'react-toastify';

export const AdminDashboard = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    productsCount: 0,
    ordersCount: 0,
    reservationsCount: 0,
    revenue: 0,
    totalStock: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const [products, orders, reservations, inventories] = await Promise.all([
        productApi.getAllProducts(),
        adminApi.getAdminOrders(),
        adminApi.getAdminReservations(),
        inventoryApi.getAllInventories(),
      ]);

      // Calculate revenue from confirmed orders
      const confirmedRevenue = (orders || [])
        .filter((o) => o.status === 'CONFIRMED')
        .reduce((sum, o) => sum + Number(o.totalAmount), 0);

      // Calculate total stock in system
      const sumStock = (inventories || []).reduce(
        (sum, inv) => sum + (inv.totalStock || 0),
        0
      );

      setStats({
        productsCount: products.length,
        ordersCount: orders.length,
        reservationsCount: reservations.length,
        revenue: confirmedRevenue,
        totalStock: sumStock,
      });
    } catch (error) {
      console.error('Error fetching admin dashboard metrics:', error);
      toast.error('Failed to load dashboard metrics.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  const statCards = [
    {
      title: 'Active Products',
      value: stats.productsCount,
      description: 'Items in database catalog',
      icon: ShoppingBag,
      color: 'text-blue-600 bg-blue-50',
    },
    {
      title: 'Total Orders',
      value: stats.ordersCount,
      description: 'Fulfillment checks completed',
      icon: ClipboardList,
      color: 'text-emerald-600 bg-emerald-50',
    },
    {
      title: 'Reservations',
      value: stats.reservationsCount,
      description: 'Distributed cache locks',
      icon: Zap,
      color: 'text-amber-600 bg-amber-50',
    },
    {
      title: 'Total Revenue',
      value: `$${stats.revenue.toFixed(2)}`,
      description: 'From confirmed orders',
      icon: DollarSign,
      color: 'text-violet-600 bg-violet-50',
    },
    {
      title: 'Catalog Stock',
      value: stats.totalStock,
      description: 'Units available & reserved',
      icon: Package,
      color: 'text-slate-700 bg-slate-100',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Title */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Admin Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Distributed backend capabilities demonstration control panel
          </p>
        </div>
        <Button onClick={fetchStats} variant="outline" size="sm">
          Refresh Metrics
        </Button>
      </div>

      {/* Stats Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
        {statCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <Card key={idx}>
              <CardBody className="p-5 flex items-start justify-between">
                <div className="space-y-2">
                  <span className="text-xs text-slate-500 font-semibold uppercase tracking-wider block">
                    {card.title}
                  </span>
                  <span className="text-2xl font-extrabold text-slate-800 block">
                    {card.value}
                  </span>
                  <span className="text-[11px] text-slate-400 block">
                    {card.description}
                  </span>
                </div>
                <div className={`p-2.5 rounded-lg ${card.color}`}>
                  <Icon className="h-5 w-5" />
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Admin Modules Navigation */}
      <div>
        <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-4">
          Management Modules
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Products Management Card */}
          <Card>
            <CardBody className="p-6 space-y-4">
              <h3 className="text-lg font-bold text-slate-800">Product Management</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Add new products, update description and price info, or activate/deactivate
                items in the catalog database.
              </p>
              <Link to="/admin/products" className="inline-flex items-center text-xs font-semibold text-blue-600 hover:text-blue-800">
                Manage Products
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </CardBody>
          </Card>

          {/* Inventory Management Card */}
          <Card>
            <CardBody className="p-6 space-y-4">
              <h3 className="text-lg font-bold text-slate-800">Inventory Stock Controller</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Increment inventory stock levels, view total vs available stock, and check
                current database allocations.
              </p>
              <Link to="/admin/inventory" className="inline-flex items-center text-xs font-semibold text-blue-600 hover:text-blue-800">
                Manage Stock
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </CardBody>
          </Card>

          {/* Flash Sales Management Card */}
          <Card>
            <CardBody className="p-6 space-y-4">
              <h3 className="text-lg font-bold text-slate-800">Flash Sale Scheduler</h3>
              <p className="text-xs text-slate-500 leading-relaxed">
                Schedule new flash sale events with custom start and end timestamps, cancel
                sales, or assign products.
              </p>
              <Link to="/admin/flash-sales" className="inline-flex items-center text-xs font-semibold text-blue-600 hover:text-blue-800">
                Schedule Sales
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
