import React from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/Button';
import Card, { CardBody } from '../components/Card';
import { AlertCircle } from 'lucide-react';

export const NotFound = () => {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <Card className="max-w-md w-full p-8 text-center space-y-5">
        <AlertCircle className="h-16 w-16 text-slate-400 mx-auto" />
        <div>
          <h1 className="text-2xl font-bold text-slate-800">404 - Page Not Found</h1>
          <p className="text-xs text-slate-500 mt-2">
            The page you are looking for does not exist or has been moved.
          </p>
        </div>
        <div className="pt-2">
          <Link to="/products">
            <Button className="w-full">
              Back to Catalog
            </Button>
          </Link>
        </div>
      </Card>
    </div>
  );
};

export default NotFound;
