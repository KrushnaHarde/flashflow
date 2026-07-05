import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import adminApi from '../services/adminApi';
import productApi from '../services/productApi';
import inventoryApi from '../services/inventoryApi';
import Input from '../components/Input';
import Button from '../components/Button';
import Card, { CardBody, CardHeader } from '../components/Card';
import { ArrowLeft, Save } from 'lucide-react';
import { toast } from 'react-toastify';

export const AddEditProduct = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEditMode = !!id;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({
    defaultValues: {
      name: '',
      description: '',
      coverImg: '',
      price: '',
      initialStock: 0,
    },
  });

  useEffect(() => {
    if (!isEditMode) return;

    const loadProduct = async () => {
      try {
        setLoading(true);
        const data = await productApi.getProductById(id);
        setValue('name', data.name || '');
        setValue('description', data.description || '');
        setValue('coverImg', data.coverImg || '');
        setValue('price', data.price || '');
      } catch (error) {
        console.error('Error fetching product for editing:', error);
        toast.error('Failed to load product details.');
        navigate('/admin/products');
      } finally {
        setLoading(false);
      }
    };

    loadProduct();
  }, [id, isEditMode, setValue, navigate]);

  const onSubmit = async (data) => {
    try {
      setSaving(true);
      const productPayload = {
        name: data.name,
        description: data.description,
        coverImg: data.coverImg,
        price: parseFloat(data.price),
      };

      if (isEditMode) {
        await adminApi.updateProduct(id, productPayload);
        toast.success('Product updated successfully!');
      } else {
        const createdProduct = await adminApi.createProduct(productPayload);
        
        // If initial stock is specified, save inventory stock level
        const stockQty = parseInt(data.initialStock, 10);
        if (stockQty > 0) {
          try {
            await inventoryApi.addStock(createdProduct.productId, stockQty);
          } catch (invErr) {
            console.error('Failed to set initial stock:', invErr);
            toast.warning('Product created, but failed to set initial stock levels.');
          }
        }
        
        toast.success('Product created successfully!');
      }
      navigate('/admin/products');
    } catch (error) {
      console.error('Failed to save product details:', error);
    } finally {
      setSaving(false);
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
    <div className="space-y-6 max-w-lg mx-auto">
      <Link
        to="/admin/products"
        className="inline-flex items-center text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5 mr-1" />
        Back to Products List
      </Link>

      <Card>
        <CardHeader className="font-bold text-slate-800 text-lg">
          {isEditMode ? 'Edit Catalog Product' : 'Add New Catalog Product'}
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label="Product Name"
              placeholder="e.g. iPhone 15 Pro Max"
              error={errors.name}
              {...register('name', { required: 'Product name is required' })}
            />

            <div className="flex flex-col space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Description
              </label>
              <textarea
                placeholder="Product specifications, features, details..."
                rows={4}
                className="px-3 py-2 text-sm bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                {...register('description')}
              />
            </div>

            <Input
              label="Cover Image URL"
              placeholder="https://example.com/image.png"
              error={errors.coverImg}
              {...register('coverImg')}
            />

            <Input
              label="Unit Price ($)"
              type="number"
              step="0.01"
              placeholder="999.99"
              error={errors.price}
              {...register('price', {
                required: 'Price is required',
                min: { value: 0.01, message: 'Price must be greater than 0' },
              })}
            />

            {!isEditMode && (
              <Input
                label="Initial Stock Quantity"
                type="number"
                placeholder="100"
                error={errors.initialStock}
                {...register('initialStock', {
                  min: { value: 0, message: 'Stock cannot be negative' },
                })}
              />
            )}

            <div className="pt-4 flex justify-end space-x-3">
              <Link to="/admin/products">
                <Button variant="outline">Cancel</Button>
              </Link>
              <Button type="submit" variant="primary" isLoading={saving}>
                <Save className="h-4 w-4 mr-1.5" />
                Save Product
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
};

export default AddEditProduct;
