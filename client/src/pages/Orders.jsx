import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import orderApi from '../services/orderApi';
import productApi from '../services/productApi';
import Badge from '../components/Badge';
import Button from '../components/Button';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import Card, { CardBody } from '../components/Card';
import { RefreshCw, ClipboardList } from 'lucide-react';
import { toast } from 'react-toastify';

export const Orders = () => {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [productsMap, setProductsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (showToast = false) => {
    try {
      if (showToast) setRefreshing(true);
      
      const [ordersList, productsList] = await Promise.all([
        orderApi.getOrders(user.userId),
        productApi.getAllProducts(),
      ]);

      // Create a map of productId -> product details
      const pMap = {};
      productsList.forEach((p) => {
        pMap[p.productId] = p;
      });

      // Sort orders by createdAt descending
      const sortedOrders = (ordersList || []).sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );

      setOrders(sortedOrders);
      setProductsMap(pMap);
      if (showToast) toast.success('Orders list refreshed.');
    } catch (error) {
      console.error('Error fetching orders:', error);
      toast.error('Failed to load orders.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user.userId]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Your Orders</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            View status and history of your reservation purchases
          </p>
        </div>
        <Button
          onClick={() => fetchData(true)}
          variant="outline"
          size="sm"
          isLoading={refreshing}
        >
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Refresh
        </Button>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          title="No Orders Found"
          description="You haven't placed any orders yet. Visit the catalog to make a purchase."
          icon={<ClipboardList className="h-10 w-10 text-slate-300 mb-3" />}
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-xs font-semibold">
              <tr>
                <th className="px-6 py-4">Order ID</th>
                <th className="px-6 py-4">Product</th>
                <th className="px-6 py-4">Quantity</th>
                <th className="px-6 py-4">Total Amount</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Created Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {orders.map((order) => {
                const product = productsMap[order.productId];
                
                let statusBadge = <Badge variant="default">{order.status}</Badge>;
                if (order.status === 'CONFIRMED') {
                  statusBadge = <Badge variant="success">CONFIRMED</Badge>;
                } else if (order.status === 'PENDING') {
                  statusBadge = <Badge variant="info">PENDING</Badge>;
                } else if (order.status === 'FAILED') {
                  statusBadge = <Badge variant="danger">FAILED</Badge>;
                } else if (order.status === 'CANCELLED') {
                  statusBadge = <Badge variant="warning">CANCELLED</Badge>;
                }

                return (
                  <tr key={order.orderId} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs text-slate-500">
                      {order.orderId}
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-800">
                      {product ? product.name : 'Unknown Product'}
                    </td>
                    <td className="px-6 py-4">
                      {order.quantity}
                    </td>
                    <td className="px-6 py-4 font-semibold">
                      ${Number(order.totalAmount).toFixed(2)}
                    </td>
                    <td className="px-6 py-4">
                      {statusBadge}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500">
                      {new Date(order.createdAt).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
};

export default Orders;
