import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import adminApi from '../services/adminApi';
import productApi from '../services/productApi';
import Card, { CardBody, CardHeader } from '../components/Card';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';
import Button from '../components/Button';
import Input from '../components/Input';
import ConfirmationModal from '../components/ConfirmationModal';
import { ArrowLeft, RefreshCw, Calendar, Trash2, Clock } from 'lucide-react';
import { toast } from 'react-toastify';

export const AdminFlashSales = () => {
  const [sales, setSales] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  // react-hook-form
  const { register, handleSubmit, reset, setValue, watch } = useForm({
    defaultValues: {
      name: '',
      startTime: '',
      endTime: '',
      productIds: [],
    },
  });

  const watchedProductIds = watch('productIds') || [];

  // Modal State
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [saleToCancel, setSaleToCancel] = useState(null);
  const [cancelling, setCancelling] = useState(false);

  const fetchData = async (showToast = false) => {
    try {
      if (showToast) setRefreshing(true);
      const [salesData, productsData] = await Promise.all([
        productApi.getFlashSales(),
        productApi.getAllProducts(),
      ]);

      setSales(salesData || []);
      setProducts(productsData || []);
      if (showToast) toast.success('Flash sales schedule updated.');
    } catch (error) {
      console.error('Error fetching flash sale schedule:', error);
      toast.error('Failed to load flash sales.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const getSaleStatus = (sale) => {
    const now = new Date().getTime();
    const start = new Date(sale.startTime).getTime();
    const end = sale.endTime ? new Date(sale.endTime).getTime() : null;

    if (now >= start && (!end || now <= end)) {
      return 'LIVE';
    }
    if (now < start) {
      return 'UPCOMING';
    }
    return 'ENDED';
  };

  const handleProductToggle = (productId) => {
    const current = watchedProductIds;
    const next = current.includes(productId)
      ? current.filter((id) => id !== productId)
      : [...current, productId];
    setValue('productIds', next, { shouldValidate: true });
  };

  const onSubmit = async (data) => {
    if (!data.name) {
      toast.error('Please enter a sale name.');
      return;
    }
    if (!data.startTime) {
      toast.error('Please select a start time.');
      return;
    }
    if (data.endTime && new Date(data.endTime) <= new Date(data.startTime)) {
      toast.error('End time must be after the start time.');
      return;
    }
    if (data.productIds.length === 0) {
      toast.error('Please select at least one product.');
      return;
    }

    try {
      setSaving(true);
      const saleId = window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : Math.random().toString(36).substring(2) + Date.now().toString(36);

      // Backend expects LocalDateTime fields in ISO-8601 format: YYYY-MM-DDTHH:MM:SS
      const formattedStart = new Date(data.startTime).toISOString().slice(0, 19);
      const formattedEnd = data.endTime ? new Date(data.endTime).toISOString().slice(0, 19) : null;

      const salePayload = {
        saleId,
        name: data.name,
        startTime: formattedStart,
        endTime: formattedEnd,
        productIds: data.productIds,
      };

      await adminApi.createFlashSale(salePayload);
      toast.success('Flash sale scheduled successfully!');
      
      reset();
      fetchData();
    } catch (error) {
      console.error('Error creating flash sale:', error);
    } finally {
      setSaving(false);
    }
  };

  const openCancelModal = (sale) => {
    setSaleToCancel(sale);
    setCancelModalOpen(true);
  };

  const handleCancelSale = async () => {
    if (!saleToCancel) return;
    try {
      setCancelling(true);
      await adminApi.deleteFlashSale(saleToCancel.saleId);
      toast.success('Flash sale cancelled successfully.');
      setCancelModalOpen(false);
      setSaleToCancel(null);
      fetchData();
    } catch (error) {
      console.error('Error cancelling flash sale:', error);
    } finally {
      setCancelling(false);
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
          <h1 className="text-2xl font-bold text-slate-800">Flash Sale Schedules</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Configure, inspect, or cancel high-concurrency flash sale windows
          </p>
        </div>
        <Button
          onClick={() => fetchData(true)}
          variant="outline"
          size="sm"
          isLoading={refreshing}
        >
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Refresh Lists
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Scheduled Sales List (Left columns) */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Current Schedule Listings
          </h2>
          
          {sales.length === 0 ? (
            <Card className="p-8 text-center text-slate-500">
              <Calendar className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              No flash sales are scheduled at the moment.
            </Card>
          ) : (
            <div className="space-y-4">
              {sales.map((sale) => {
                const status = getSaleStatus(sale);
                
                let badgeVariant = 'default';
                if (status === 'LIVE') badgeVariant = 'success';
                else if (status === 'UPCOMING') badgeVariant = 'info';

                return (
                  <Card key={sale.saleId} className="hover:shadow-sm transition-shadow">
                    <CardBody className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-1.5 flex-grow">
                        <div className="flex items-center space-x-2">
                          <h3 className="text-base font-bold text-slate-800">{sale.name}</h3>
                          <Badge variant={badgeVariant}>{status}</Badge>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500 font-medium">
                          <div className="flex items-center">
                            <Clock className="h-3.5 w-3.5 text-slate-400 mr-1.5" />
                            Start: {new Date(sale.startTime).toLocaleString()}
                          </div>
                          {sale.endTime && (
                            <div className="flex items-center">
                              <Clock className="h-3.5 w-3.5 text-slate-400 mr-1.5" />
                              End: {new Date(sale.endTime).toLocaleString()}
                            </div>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-2">
                          Products included: {sale.productIds?.length || 0}
                        </div>
                      </div>
                      
                      {/* Action Cancel Button */}
                      <div className="flex-shrink-0 flex items-center">
                        <Button
                          variant="secondary"
                          className="bg-red-50 text-red-700 hover:bg-red-100 p-2 rounded"
                          onClick={() => openCancelModal(sale)}
                          disabled={status === 'ENDED'}
                        >
                          <Trash2 className="h-4 w-4 mr-1.5" />
                          Cancel Sale
                        </Button>
                      </div>
                    </CardBody>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Schedule a Sale Form (Right column) */}
        <div>
          <Card>
            <CardHeader className="font-bold text-slate-800 text-sm uppercase tracking-wider">
              Schedule New Flash Sale
            </CardHeader>
            <CardBody>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <Input
                  label="Sale Name"
                  placeholder="e.g. Black Friday Flash"
                  {...register('name')}
                />

                <Input
                  label="Start Date & Time"
                  type="datetime-local"
                  {...register('startTime')}
                />

                <Input
                  label="End Date & Time (Optional)"
                  type="datetime-local"
                  {...register('endTime')}
                />

                {/* Product Association checkboxes */}
                <div className="flex flex-col space-y-2">
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Select Products
                  </label>
                  <div className="border border-slate-200 rounded max-h-48 overflow-y-auto p-2 bg-white divide-y divide-slate-100">
                    {products.length === 0 ? (
                      <span className="text-xs text-slate-400 p-2 block">No products in catalog</span>
                    ) : (
                      products.map((p) => (
                        <label
                          key={p.productId}
                          className="flex items-center py-2 px-1 cursor-pointer select-none text-xs text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          <input
                            type="checkbox"
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 mr-2.5 h-4 w-4"
                            checked={watchedProductIds.includes(p.productId)}
                            onChange={() => handleProductToggle(p.productId)}
                          />
                          <div className="flex-grow">
                            <div className="font-semibold text-slate-800">{p.name}</div>
                            <div className="text-[10px] text-slate-400">Price: ${Number(p.price).toFixed(2)}</div>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full mt-4"
                  isLoading={saving}
                >
                  Schedule Sale Window
                </Button>
              </form>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Confirmation modal for Cancellation */}
      <ConfirmationModal
        isOpen={cancelModalOpen}
        title="Cancel Flash Sale Schedule?"
        description={`This will immediately terminate or cancel the schedule for '${saleToCancel?.name}'. Active sales will end immediately.`}
        confirmText="Cancel Sale"
        cancelText="Keep Scheduled"
        onConfirm={handleCancelSale}
        onCancel={() => {
          setCancelModalOpen(false);
          setSaleToCancel(null);
        }}
        isLoading={cancelling}
      />
    </div>
  );
};

export default AdminFlashSales;
