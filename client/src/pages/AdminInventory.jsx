import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import inventoryApi from '../services/inventoryApi';
import productApi from '../services/productApi';
import Card, { CardBody } from '../components/Card';
import Spinner from '../components/Spinner';
import Button from '../components/Button';
import Input from '../components/Input';
import { ArrowLeft, RefreshCw, Plus, Package } from 'lucide-react';
import { toast } from 'react-toastify';

export const AdminInventory = () => {
  const [inventories, setInventories] = useState([]);
  const [productsMap, setProductsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addStockQtyMap, setAddStockQtyMap] = useState({});
  const [actionLoadingMap, setActionLoadingMap] = useState({});

  const fetchData = async (showToast = false) => {
    try {
      if (showToast) setRefreshing(true);
      
      const [inventoriesList, productsList] = await Promise.all([
        inventoryApi.getAllInventories(),
        productApi.getAllProducts(),
      ]);

      const pMap = {};
      productsList.forEach((p) => {
        pMap[p.productId] = p;
      });

      setInventories(inventoriesList || []);
      setProductsMap(pMap);
      
      if (showToast) toast.success('Inventory counts refreshed.');
    } catch (error) {
      console.error('Error fetching inventory counts:', error);
      toast.error('Failed to load inventories.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddStock = async (productId) => {
    const qty = parseInt(addStockQtyMap[productId], 10);
    if (!qty || qty <= 0) {
      toast.error('Please enter a quantity greater than zero.');
      return;
    }

    try {
      setActionLoadingMap((prev) => ({ ...prev, [productId]: true }));
      await inventoryApi.addStock(productId, qty);
      toast.success(`Successfully added ${qty} units to stock.`);
      
      // Reset input qty
      setAddStockQtyMap((prev) => ({ ...prev, [productId]: '' }));
      
      // Reload details
      fetchData();
    } catch (error) {
      console.error('Error updating stock level:', error);
    } finally {
      setActionLoadingMap((prev) => ({ ...prev, [productId]: false }));
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/admin" className="inline-flex items-center text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors">
        <ArrowLeft className="h-3.5 w-3.5 mr-1" />
        Back to Dashboard
      </Link>

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Inventory Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Add stock, adjust quantities, and monitor distributed lock allocations
          </p>
        </div>
        <Button
          onClick={() => fetchData(true)}
          variant="outline"
          size="sm"
          isLoading={refreshing}
        >
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Refresh Counts
        </Button>
      </div>

      {inventories.length === 0 ? (
        <Card className="p-8 text-center text-slate-500">
          <Package className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          No inventory listings found in DB. Make sure you have created and activated products.
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-xs font-semibold">
              <tr>
                <th className="px-6 py-4">Product Name</th>
                <th className="px-6 py-4">Total Stock</th>
                <th className="px-6 py-4">Available (Ready)</th>
                <th className="px-6 py-4">Reserved (Held)</th>
                <th className="px-6 py-4">Sold (Claimed)</th>
                <th className="px-6 py-4 text-right">Add Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {inventories.map((inv) => {
                const product = productsMap[inv.productId];
                
                // Calculated Sold stock
                const sold = (inv.totalStock || 0) - (inv.availableStock || 0) - (inv.reservedStock || 0);
                const isActionLoading = !!actionLoadingMap[inv.productId];

                return (
                  <tr key={inv.productId} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-semibold text-slate-800">
                      {product ? product.name : 'Unknown Product'}
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">{inv.productId}</div>
                    </td>
                    <td className="px-6 py-4">{inv.totalStock}</td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-emerald-600">{inv.availableStock}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-amber-600">{inv.reservedStock}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-blue-600">{Math.max(0, sold)}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex items-center space-x-2">
                        <input
                          type="number"
                          placeholder="Qty"
                          className="w-16 px-2 py-1 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={addStockQtyMap[inv.productId] || ''}
                          onChange={(e) =>
                            setAddStockQtyMap((prev) => ({
                              ...prev,
                              [inv.productId]: e.target.value,
                            }))
                          }
                          disabled={isActionLoading}
                        />
                        <Button
                          variant="primary"
                          size="sm"
                          className="px-2.5 py-1 text-xs"
                          onClick={() => handleAddStock(inv.productId)}
                          isLoading={isActionLoading}
                        >
                          <Plus className="h-3 w-3 mr-0.5" />
                          Add
                        </Button>
                      </div>
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

export default AdminInventory;
