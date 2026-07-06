import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import productApi from '../services/productApi';
import purchaseApi from '../services/purchaseApi';
import Card, { CardBody, CardFooter } from '../components/Card';
import Badge from '../components/Badge';
import Button from '../components/Button';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import { ShoppingBag, Timer, Shield } from 'lucide-react';
import { toast } from 'react-toastify';

export const Products = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [inventories, setInventories] = useState({});
  const [loading, setLoading] = useState(true);
  const [purchaseLoadingMap, setPurchaseLoadingMap] = useState({});

  const fetchData = async () => {
    try {
      setLoading(true);
      const [productsData, salesData] = await Promise.all([
        productApi.getAllProducts(),
        productApi.getFlashSales(),
      ]);

      setProducts(productsData);
      setSales(salesData);

      // Asynchronously fetch inventory details for each product
      const inventoryMap = {};
      await Promise.all(
        productsData.map(async (product) => {
          try {
            const inv = await productApi.getProductInventory(product.productId);
            inventoryMap[product.productId] = inv;
          } catch (err) {
            console.warn(`Failed to fetch inventory for product ${product.productId}:`, err);
            inventoryMap[product.productId] = { availableStock: 0, totalStock: 0 };
          }
        })
      );
      setInventories(inventoryMap);
    } catch (error) {
      console.error('Error fetching catalog data:', error);
      toast.error('Failed to load products. Please check server connections.');
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

  const handleBuy = async (product, flashSaleInfo) => {
    const productId = product.productId;
    const inventory = inventories[productId] || { availableStock: 0 };
    
    // Check local conditions before sending request
    if (product.status !== 'ACTIVE') {
      toast.error('Product is inactive');
      return;
    }
    if (inventory.availableStock <= 0) {
      toast.error('Product is out of stock');
      return;
    }
    if (flashSaleInfo && flashSaleInfo.status === 'UPCOMING') {
      toast.error('Flash sale has not started yet');
      return;
    }
    if (flashSaleInfo && flashSaleInfo.status === 'ENDED') {
      toast.error('Flash sale has ended');
      return;
    }

    const idempotencyKey = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : Math.random().toString(36).substring(2) + Date.now().toString(36);

    try {
      setPurchaseLoadingMap((prev) => ({ ...prev, [productId]: true }));
      toast.info('Initiating reservation checkouts...');

      const response = await purchaseApi.purchase({
        userId: user.userId,
        productId: productId,
        quantity: 1,
        idempotencyKey: idempotencyKey,
      });

      toast.success('Reservation successfully accepted!');
      
      // Navigate to purchase status page
      if (response && response.reservationId) {
        navigate(`/purchase/${response.reservationId}/status`);
      } else {
        toast.error('Failed to retrieve reservation ID from server.');
      }
    } catch (error) {
      console.error('Purchase request failed:', error);
      // Errors handled by Axios interceptors
    } finally {
      setPurchaseLoadingMap((prev) => ({ ...prev, [productId]: false }));
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="max-w-xl mx-auto">
        <EmptyState
          title="No Products Available"
          description="We couldn't find any products in the catalog. If you are an Admin, you can add products via the Admin console."
          actionButton={
            user?.role === 'ADMIN' && (
              <Button onClick={() => navigate('/admin/products/new')}>
                Add Product
              </Button>
            )
          }
        />
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">FlashFlow Catalog</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Test concurrent flash sales and high-concurrency checkouts
          </p>
        </div>
        <Button onClick={fetchData} variant="outline" size="sm">
          Refresh List
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {products.map((product) => {
          const inventory = inventories[product.productId] || { availableStock: 0, totalStock: 0 };
          const flashSaleInfo = getFlashSaleInfo(product);
          const isPurchaseLoading = !!purchaseLoadingMap[product.productId];

          // Determine Badge and Disable Status
          let statusBadge = null;
          let isBuyDisabled = product.status !== 'ACTIVE' || inventory.availableStock <= 0;

          if (product.status !== 'ACTIVE') {
            statusBadge = <Badge variant="default">INACTIVE</Badge>;
          } else if (inventory.availableStock <= 0) {
            statusBadge = <Badge variant="danger">OUT OF STOCK</Badge>;
          } else if (flashSaleInfo) {
            if (flashSaleInfo.status === 'LIVE') {
              statusBadge = <Badge variant="success">LIVE SALE</Badge>;
            } else if (flashSaleInfo.status === 'UPCOMING') {
              statusBadge = <Badge variant="info">UPCOMING</Badge>;
              isBuyDisabled = true;
            } else if (flashSaleInfo.status === 'ENDED') {
              statusBadge = <Badge variant="default">ENDED</Badge>;
              isBuyDisabled = true;
            }
          } else {
            statusBadge = <Badge variant="default">NO SALE</Badge>;
            isBuyDisabled = true;
          }

          return (
            <Card key={product.productId} className="flex flex-col h-full hover:shadow-md transition-shadow">
              {/* Product Cover Image */}
              <div className="relative h-48 w-full bg-slate-100 flex items-center justify-center">
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
                  <ShoppingBag className="h-12 w-12 text-slate-300" />
                )}
                <div className="absolute top-3 left-3">{statusBadge}</div>
              </div>

              {/* Product Info */}
              <CardBody className="flex-grow flex flex-col justify-between">
                <div>
                  <h3 className="text-base font-semibold text-slate-800 line-clamp-1">
                    <Link to={`/products/${product.productId}`} className="hover:underline">
                      {product.name}
                    </Link>
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2 min-h-[2rem]">
                    {product.description || 'No description provided.'}
                  </p>
                </div>

                <div className="mt-4 space-y-2.5">
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Price</span>
                    <span className="text-lg font-bold text-slate-800">${Number(product.price).toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between items-center text-xs text-slate-600 border-t border-slate-100 pt-2">
                    <span>Stock Available</span>
                    <span className="font-semibold text-slate-800">
                      {inventory.availableStock} / {inventory.totalStock}
                    </span>
                  </div>

                  {flashSaleInfo && (
                    <div className="bg-slate-50 rounded p-2 flex flex-col space-y-1 text-[11px] text-slate-500">
                      <div className="flex items-center text-slate-600 font-medium">
                        <Timer className="h-3 w-3 mr-1 text-blue-500" />
                        <span>Flash Sale Scheduled</span>
                      </div>
                      <div>
                        Start: {new Date(flashSaleInfo.sale.startTime).toLocaleString()}
                      </div>
                      {flashSaleInfo.sale.endTime && (
                        <div>
                          End: {new Date(flashSaleInfo.sale.endTime).toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardBody>

              {/* Footer Buy Button */}
              <CardFooter className="pt-0">
                <Button
                  variant={isBuyDisabled ? 'outline' : 'primary'}
                  className="w-full"
                  disabled={isBuyDisabled}
                  isLoading={isPurchaseLoading}
                  onClick={() => handleBuy(product, flashSaleInfo)}
                >
                  {inventory.availableStock <= 0
                    ? 'Out of Stock'
                    : !flashSaleInfo
                    ? 'No Active Sale'
                    : flashSaleInfo.status === 'UPCOMING'
                    ? 'Sale Upcoming'
                    : flashSaleInfo.status === 'ENDED'
                    ? 'Sale Ended'
                    : 'Buy Now'}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default Products;
