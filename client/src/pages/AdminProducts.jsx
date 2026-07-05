import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import productApi from '../services/productApi';
import adminApi from '../services/adminApi';
import Badge from '../components/Badge';
import Button from '../components/Button';
import Spinner from '../components/Spinner';
import Card from '../components/Card';
import { Plus, Eye, Edit2, Play, Square, ShoppingBag, ArrowLeft } from 'lucide-react';
import { toast } from 'react-toastify';

export const AdminProducts = () => {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [productsData, salesData] = await Promise.all([
        productApi.getAllProducts(),
        productApi.getFlashSales(),
      ]);
      setProducts(productsData);
      setSales(salesData);
    } catch (error) {
      console.error('Error fetching admin products:', error);
      toast.error('Failed to load products list.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getFlashSaleInfo = (product) => {
    const productSales = sales.filter((s) => s.productIds?.includes(product.productId));
    if (productSales.length === 0) return null;

    const now = new Date();
    
    // Find active sale
    const activeSale = productSales.find((s) => {
      const start = new Date(s.startTime);
      const end = s.endTime ? new Date(s.endTime) : null;
      return now >= start && (!end || now <= end);
    });

    if (activeSale) {
      return { sale: activeSale, status: 'LIVE' };
    }

    // Find upcoming sale
    const upcomingSale = productSales
      .filter((s) => new Date(s.startTime) > now)
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))[0];

    if (upcomingSale) {
      return { sale: upcomingSale, status: 'UPCOMING' };
    }

    // Find ended sale
    const endedSale = productSales
      .filter((s) => s.endTime && new Date(s.endTime) < now)
      .sort((a, b) => new Date(b.endTime) - new Date(a.endTime))[0];

    if (endedSale) {
      return { sale: endedSale, status: 'ENDED' };
    }

    return null;
  };

  const handleActivate = async (id) => {
    try {
      setActionLoadingId(id);
      await adminApi.activateProduct(id);
      toast.success('Product activated successfully and stock pre-warmed.');
      fetchData();
    } catch (error) {
      console.error('Failed to activate product:', error);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeactivate = async (id) => {
    try {
      setActionLoadingId(id);
      await adminApi.deactivateProduct(id);
      toast.success('Product deactivated successfully.');
      fetchData();
    } catch (error) {
      console.error('Failed to deactivate product:', error);
    } finally {
      setActionLoadingId(null);
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
          <h1 className="text-2xl font-bold text-slate-800">Manage Catalog Products</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Add new products or activate/deactivate listings
          </p>
        </div>
        <Button onClick={() => navigate('/admin/products/new')} variant="primary" size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          Add Product
        </Button>
      </div>

      <Card className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
          <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-xs font-semibold">
            <tr>
              <th className="px-6 py-4 w-20">Image</th>
              <th className="px-6 py-4">Name</th>
              <th className="px-6 py-4">Price</th>
              <th className="px-6 py-4">DB Status</th>
              <th className="px-6 py-4">Flash Sale Status</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {products.map((product) => {
              const saleInfo = getFlashSaleInfo(product);
              
              let saleBadge = <Badge variant="default">NO SALE</Badge>;
              if (saleInfo) {
                if (saleInfo.status === 'LIVE') {
                  saleBadge = <Badge variant="success">LIVE SALE</Badge>;
                } else if (saleInfo.status === 'UPCOMING') {
                  saleBadge = <Badge variant="info">UPCOMING</Badge>;
                } else if (saleInfo.status === 'ENDED') {
                  saleBadge = <Badge variant="default">ENDED</Badge>;
                }
              }

              const isActionLoading = actionLoadingId === product.productId;

              return (
                <tr key={product.productId} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="h-10 w-10 bg-slate-100 rounded overflow-hidden flex items-center justify-center border border-slate-200">
                      {product.coverImg ? (
                        <img
                          src={product.coverImg}
                          alt={product.name}
                          className="h-full w-full object-cover"
                          onError={(e) => {
                            e.target.onerror = null;
                            e.target.src = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500';
                          }}
                        />
                      ) : (
                        <ShoppingBag className="h-5 w-5 text-slate-300" />
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-semibold text-slate-800">{product.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">{product.productId}</div>
                  </td>
                  <td className="px-6 py-4 font-semibold text-slate-800">
                    ${Number(product.price).toFixed(2)}
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={product.status === 'ACTIVE' ? 'success' : 'default'}>
                      {product.status}
                    </Badge>
                  </td>
                  <td className="px-6 py-4">
                    {saleBadge}
                  </td>
                  <td className="px-6 py-4 text-right space-x-1.5 whitespace-nowrap">
                    <Link to={`/products/${product.productId}`} title="View Product Page">
                      <Button variant="outline" size="sm" className="p-1.5">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </Link>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      className="p-1.5"
                      onClick={() => navigate(`/admin/products/${product.productId}`)}
                      title="Edit Details"
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>

                    {product.status === 'ACTIVE' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="p-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700"
                        onClick={() => handleDeactivate(product.productId)}
                        isLoading={isActionLoading}
                        title="Deactivate Product"
                      >
                        <Square className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700"
                        onClick={() => handleActivate(product.productId)}
                        isLoading={isActionLoading}
                        title="Activate Product"
                      >
                        <Play className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
};

export default AdminProducts;
