import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import purchaseApi from '../services/purchaseApi';
import Card, { CardBody, CardHeader, CardFooter } from '../components/Card';
import Badge from '../components/Badge';
import Spinner from '../components/Spinner';
import Button from '../components/Button';
import { CheckCircle2, XCircle, AlertCircle, ShoppingBag, ClipboardList } from 'lucide-react';
import { toast } from 'react-toastify';

export const PurchaseStatus = () => {
  const { reservationId } = useParams();
  const [statusInfo, setStatusInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(true);
  const [errorCount, setErrorCount] = useState(0);

  const fetchStatus = async () => {
    try {
      const data = await purchaseApi.getPurchaseStatus(reservationId);
      setStatusInfo(data);
      setLoading(false);
      setErrorCount(0); // Reset errors on successful query

      // Terminal conditions to stop polling
      const isReservationTerminal = ['EXPIRED', 'CANCELLED'].includes(data.reservationStatus);
      const isOrderTerminal = ['CONFIRMED', 'FAILED', 'CANCELLED'].includes(data.orderStatus);

      if (isReservationTerminal || isOrderTerminal) {
        setPolling(false);
      }
    } catch (error) {
      console.error('Error polling reservation status:', error);
      setErrorCount((prev) => prev + 1);
      
      // Stop polling after too many errors
      if (errorCount > 5) {
        setPolling(false);
        setLoading(false);
        toast.error('Unable to fetch checkout progress. Please check orders page.');
      }
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchStatus();

    if (!polling) return;

    // Poll every 2 seconds
    const interval = setInterval(fetchStatus, 2000);

    return () => clearInterval(interval);
  }, [reservationId, polling, errorCount]);

  // Determine Overall Status Color, Message, and Icon
  let statusColor = 'bg-blue-50 border-blue-200 text-blue-800';
  let statusTitle = 'Processing Checkout';
  let statusDesc = 'We are verifying stock levels and scheduling your order fulfillment transaction.';
  let statusIcon = <Spinner size="lg" className="mx-auto" />;

  if (statusInfo) {
    const { reservationStatus, orderStatus, paymentStatus } = statusInfo;

    if (orderStatus === 'CONFIRMED') {
      statusColor = 'bg-emerald-50 border-emerald-200 text-emerald-800';
      statusTitle = 'Purchase Confirmed!';
      statusDesc = 'Your checkout was completed successfully! Stock has been reserved and order is ready.';
      statusIcon = <CheckCircle2 className="h-16 w-16 text-emerald-600 mx-auto" />;
    } else if (orderStatus === 'FAILED' || reservationStatus === 'CANCELLED') {
      statusColor = 'bg-red-50 border-red-200 text-red-800';
      statusTitle = 'Purchase Failed';
      statusDesc = 'The transaction was cancelled or stock reservation was lost. Please try again.';
      statusIcon = <XCircle className="h-16 w-16 text-red-600 mx-auto" />;
    } else if (reservationStatus === 'EXPIRED') {
      statusColor = 'bg-amber-50 border-amber-200 text-amber-800';
      statusTitle = 'Reservation Expired';
      statusDesc = 'Your reservation checkout window timed out before completion. Try ordering again.';
      statusIcon = <AlertCircle className="h-16 w-16 text-amber-600 mx-auto" />;
    }
  }

  return (
    <div className="max-w-md mx-auto py-6">
      <Card>
        <CardHeader className="text-center font-bold text-slate-800 text-lg">
          Transaction Processing
        </CardHeader>
        <CardBody className="space-y-6 text-center">
          {/* Main Status Display */}
          <div className="py-4">
            <div className="mb-4">{statusIcon}</div>
            <h2 className="text-xl font-bold text-slate-800">{statusTitle}</h2>
            <p className="text-xs text-slate-500 mt-2 max-w-xs mx-auto leading-relaxed">
              {statusDesc}
            </p>
          </div>

          {/* Detailed Status Breakdown */}
          {statusInfo && (
            <div className="border-t border-slate-100 pt-4 text-left space-y-3">
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Transaction Stages
              </h3>
              
              <div className="flex justify-between items-center text-sm py-1 border-b border-slate-50">
                <span className="text-slate-500">Stock Reservation</span>
                <Badge
                  variant={
                    statusInfo.reservationStatus === 'RESERVED'
                      ? 'success'
                      : statusInfo.reservationStatus === 'EXPIRED' || statusInfo.reservationStatus === 'CANCELLED'
                      ? 'danger'
                      : 'default'
                  }
                >
                  {statusInfo.reservationStatus}
                </Badge>
              </div>

              <div className="flex justify-between items-center text-sm py-1 border-b border-slate-50">
                <span className="text-slate-500">Order Creation</span>
                <Badge
                  variant={
                    statusInfo.orderStatus === 'CONFIRMED'
                      ? 'success'
                      : statusInfo.orderStatus === 'PENDING'
                      ? 'info'
                      : statusInfo.orderStatus === 'FAILED'
                      ? 'danger'
                      : 'default'
                  }
                >
                  {statusInfo.orderStatus || 'WAITING'}
                </Badge>
              </div>

              <div className="flex justify-between items-center text-sm py-1">
                <span className="text-slate-500">Payment Process</span>
                <Badge
                  variant={
                    statusInfo.paymentStatus === 'COMPLETED'
                      ? 'success'
                      : statusInfo.paymentStatus === 'PENDING'
                      ? 'info'
                      : statusInfo.paymentStatus === 'FAILED'
                      ? 'danger'
                      : 'default'
                  }
                >
                  {statusInfo.paymentStatus || 'WAITING'}
                </Badge>
              </div>
            </div>
          )}

          {/* Loading status text */}
          {polling && (
            <p className="text-[11px] text-slate-400 animate-pulse">
              Polling transaction state updates...
            </p>
          )}
        </CardBody>
        <CardFooter className="flex justify-between">
          <Link to="/products">
            <Button variant="outline" size="sm">
              <ShoppingBag className="h-4 w-4 mr-1.5" />
              Catalog
            </Button>
          </Link>
          <Link to="/orders">
            <Button variant="primary" size="sm" disabled={polling}>
              <ClipboardList className="h-4 w-4 mr-1.5" />
              View Orders
            </Button>
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
};

export default PurchaseStatus;
