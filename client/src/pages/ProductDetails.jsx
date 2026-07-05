import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import productApi from '../services/productApi';
import purchaseApi from '../services/purchaseApi';
import Button from '../components/Button';
import Spinner from '../components/Spinner';
import Badge from '../components/Badge';
import Card, { CardBody } from '../components/Card';
import { ChevronLeft, ShoppingBag, Clock, ShieldAlert } from 'lucide-react';
import { toast } from 'react-toastify';

export const ProductDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [product, setProduct] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState('');
  const [timerLabel, setTimerLabel] = useState('');

  const fetchData = async () => {
    try {
      setLoading(true);
      const [productData, salesData, inventoryData] = await Promise.all([
        productApi.getProductById(id),
        productApi.getFlashSales(),
        productApi.getProductInventory(id),
      ]);

      setProduct(productData);
      setSales(salesData);
      setInventory(inventoryData);
    } catch (error) {
      console.error('Error fetching product details:', error);
      toast.error('Failed to load product details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  // Find the most relevant sale for the current product
  const getFlashSaleInfo = () => {
    if (!product || sales.length === 0) return null;
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

  const flashSaleInfo = getFlashSaleInfo();

  // Countdown timer logic
  useEffect(() => {
    if (!flashSaleInfo) {
      setTimeRemaining('');
      setTimerLabel('');
      return;
    }

    const updateTimer = () => {
      const now = new Date().getTime();
      let targetTime = 0;

      if (flashSaleInfo.status === 'LIVE') {
        if (!flashSaleInfo.sale.endTime) {
          setTimeRemaining('No End Time Scheduled');
          setTimerLabel('Sale ends in:');
          return;
        }
        targetTime = new Date(flashSaleInfo.sale.endTime).getTime();
        setTimerLabel('Sale ends in:');
      } else if (flashSaleInfo.status === 'UPCOMING') {
        targetTime = new Date(flashSaleInfo.sale.startTime).getTime();
        setTimerLabel('Sale starts in:');
      } else {
        setTimeRemaining('Sale ended');
        setTimerLabel('');
        return;
      }

      const difference = targetTime - now;

      if (difference <= 0) {
        setTimeRemaining('0d 0h 0m 0s');
        fetchData(); // Trigger refetch to update status
        return;
      }

      const days = Math.floor(difference / (1000 * 60 * 60 * 24));
      const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((difference % (1000 * 60)) / 1000);

      setTimeRemaining(`${days}d ${hours}h ${minutes}m ${seconds}s`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [flashSaleInfo]);

  const handleBuy = async () => {
    if (!product || !inventory) return;

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
      setPurchaseLoading(true);
      toast.info('Submitting order reservation...');

      const response = await purchaseApi.purchase({
        userId: user.userId,
        productId: product.productId,
        quantity: 1,
        idempotencyKey: idempotencyKey,
      });

      toast.success('Reservation successfully accepted!');
      if (response && response.reservationId) {
        navigate(`/purchase/${response.reservationId}/status`);
      } else {
        toast.error('Failed to retrieve reservation details.');
      }
    } catch (error) {
      console.error('Purchase failed:', error);
    } finally {
      setPurchaseLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="max-w-md mx-auto">
        <Card className="p-8 text-center text-slate-500">
          Product details could not be found.
          <div className="mt-4">
            <Link to="/products">
              <Button>Return to Catalog</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // Badges & States
  let statusBadge = <Badge variant="success">AVAILABLE</Badge>;
  let isBuyDisabled = product.status !== 'ACTIVE' || inventory?.availableStock <= 0;

  if (product.status !== 'ACTIVE') {
    statusBadge = <Badge variant="default">INACTIVE</Badge>;
  } else if (inventory && inventory.availableStock <= 0) {
    statusBadge = <Badge variant="danger">OUT OF STOCK</Badge>;
  } else if (flashSaleInfo) {
    if (flashSaleInfo.status === 'LIVE') {
      statusBadge = <Badge variant="success">LIVE SALE</Badge>;
    } else if (flashSaleInfo.status === 'UPCOMING') {
      statusBadge = <Badge variant="info">UPCOMING SALE</Badge>;
      isBuyDisabled = true;
    } else if (flashSaleInfo.status === 'ENDED') {
      statusBadge = <Badge variant="default">ENDED SALE</Badge>;
      isBuyDisabled = true;
    }
  }

  return (
    <div>
      {/* Back to Products link */}
      <Link to="/products" className="inline-flex items-center text-sm font-semibold text-slate-500 hover:text-slate-800 mb-6 transition-colors">
        <ChevronLeft className="h-4 w-4 mr-1" />
        Back to catalog
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
        {/* Cover Image Block */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm flex items-center justify-center p-8 min-h-[300px]">
          {product.coverImg ? (
            <img
              src={product.coverImg}
              alt={product.name}
              className="max-h-96 object-contain rounded"
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=500';
              }}
            />
          ) : (
            <ShoppingBag className="h-24 w-24 text-slate-200" />
          )}
        </div>

        {/* Details Block */}
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center space-x-3">
              {statusBadge}
            </div>
            <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">
              {product.name}
            </h1>
            <p className="text-xl font-bold text-blue-600">
              ${Number(product.price).toFixed(2)}
            </p>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Description
            </h3>
            <p className="text-sm text-slate-600 mt-2 leading-relaxed">
              {product.description || 'No description provided for this product.'}
            </p>
          </div>

          {inventory && (
            <div className="border-t border-slate-200 pt-4 grid grid-cols-2 gap-4">
              <div className="bg-slate-50 rounded p-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Available Stock
                </span>
                <span className="text-lg font-bold text-slate-800 block mt-1">
                  {inventory.availableStock}
                </span>
              </div>
              <div className="bg-slate-50 rounded p-3">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Total Catalog Stock
                </span>
                <span className="text-lg font-bold text-slate-800 block mt-1">
                  {inventory.totalStock}
                </span>
              </div>
            </div>
          )}

          {/* Flash Sale countdown block */}
          {flashSaleInfo && timeRemaining && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-center space-x-4">
              <Clock className="h-8 w-8 text-blue-600" />
              <div>
                <span className="text-xs font-semibold text-blue-600 uppercase tracking-wider block">
                  {timerLabel || 'Flash Sale Countdown'}
                </span>
                <span className="text-lg font-bold text-slate-800 block mt-0.5">
                  {timeRemaining}
                </span>
              </div>
            </div>
          )}

          {/* Purchase Trigger */}
          <div className="border-t border-slate-200 pt-6">
            <Button
              variant={isBuyDisabled ? 'outline' : 'primary'}
              size="lg"
              className="w-full sm:w-auto min-w-[200px]"
              disabled={isBuyDisabled}
              isLoading={purchaseLoading}
              onClick={handleBuy}
            >
              {inventory?.availableStock <= 0
                ? 'Out of Stock'
                : flashSaleInfo?.status === 'UPCOMING'
                ? 'Sale Upcoming'
                : flashSaleInfo?.status === 'ENDED'
                ? 'Sale Ended'
                : 'Buy Now'}
            </Button>
            {isBuyDisabled && product.status !== 'ACTIVE' && (
              <span className="text-xs text-red-500 font-medium block mt-2 flex items-center">
                <ShieldAlert className="h-3.5 w-3.5 mr-1" />
                This product is currently inactive and cannot be purchased.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetails;
