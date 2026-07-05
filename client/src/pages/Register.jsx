import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Input from '../components/Input';
import Button from '../components/Button';
import Card, { CardBody, CardHeader } from '../components/Card';
import { Zap } from 'lucide-react';
import { toast } from 'react-toastify';

export const Register = () => {
  const { register: signup } = useAuth();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [backendError, setBackendError] = useState('');

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: {
      name: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  const password = watch('password');

  const onSubmit = async (data) => {
    setIsSubmitting(true);
    setBackendError('');
    const result = await signup(data.name, data.email, data.password);
    setIsSubmitting(false);

    if (result.success) {
      toast.success('Registration successful! Please log in.');
      navigate('/login');
    } else {
      setBackendError(result.message);
      toast.error(result.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="flex flex-col items-center mb-6">
          <Zap className="h-10 w-10 text-blue-600 fill-blue-600 mb-2" />
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight">
            Join FlashFlow Demo
          </h2>
          <p className="text-sm text-slate-500 text-center mt-1">
            Create an account to browse products and test concurrent checkouts
          </p>
        </div>

        <Card>
          <CardHeader className="text-center font-semibold text-slate-800 text-base">
            Register
          </CardHeader>
          <CardBody>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {backendError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-600 font-medium">
                  {backendError}
                </div>
              )}

              <Input
                label="Full Name"
                type="text"
                placeholder="John Doe"
                error={errors.name}
                {...register('name', { required: 'Name is required' })}
              />

              <Input
                label="Email Address"
                type="email"
                placeholder="john@example.com"
                error={errors.email}
                {...register('email', {
                  required: 'Email is required',
                  pattern: {
                    value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                    message: 'Invalid email address',
                  },
                })}
              />

              <Input
                label="Password"
                type="password"
                placeholder="••••••••"
                error={errors.password}
                {...register('password', {
                  required: 'Password is required',
                  minLength: {
                    value: 6,
                    message: 'Password must be at least 6 characters',
                  },
                })}
              />

              <Input
                label="Confirm Password"
                type="password"
                placeholder="••••••••"
                error={errors.confirmPassword}
                {...register('confirmPassword', {
                  required: 'Please confirm your password',
                  validate: (value) =>
                    value === password || 'Passwords do not match',
                })}
              />

              <Button
                type="submit"
                variant="primary"
                className="w-full mt-2"
                isLoading={isSubmitting}
              >
                Sign Up
              </Button>
            </form>

            <div className="mt-5 text-center text-xs text-slate-500">
              Already have an account?{' '}
              <Link to="/login" className="text-blue-600 font-semibold hover:underline">
                Sign in instead
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
};

export default Register;
