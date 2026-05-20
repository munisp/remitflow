import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle2, Upload, Store, Package, AlertCircle, Loader2 } from 'lucide-react';
import api from '@/lib/api';

const STEPS = [
  { id: 1, title: 'Personal Information', icon: '👤' },
  { id: 2, title: 'Business Details', icon: '🏢' },
  { id: 3, title: 'KYB Verification', icon: '📄' },
  { id: 4, title: 'Create Store', icon: '🏪' },
  { id: 5, title: 'Add Products', icon: '📦' },
  { id: 6, title: 'Success', icon: '🎉' }
];

export default function OnboardingFlow() {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [agentId, setAgentId] = useState(null);
  const [storeId, setStoreId] = useState(null);

  const [personalInfo, setPersonalInfo] = useState({
    firstName: '', lastName: '', email: '', phone: '', nationalId: '',
    address: '', city: '', state: '', country: 'Nigeria'
  });

  const [businessInfo, setBusinessInfo] = useState({
    businessName: '', registrationNumber: '', businessType: '', industry: '',
    yearsInBusiness: '', taxId: '', businessAddress: '', businessPhone: '', businessEmail: ''
  });

  const [kybDocuments, setKybDocuments] = useState({
    registration: null, tin: null, proofOfAddress: null
  });

  const [storeInfo, setStoreInfo] = useState({
    name: '', description: '', slug: '', currency: 'NGN', logo: null, banner: null,
    paymentMethods: ['stripe', 'paypal', 'mobile_money', 'bank_transfer']
  });

  const [products, setProducts] = useState([{
    name: '', sku: '', description: '', price: '', category: 'clothing',
    stock: '', weight: '', sizes: '', colors: '', images: []
  }]);

  const validateStep = () => {
    setError(null);
    if (currentStep === 1) {
      if (!personalInfo.firstName || !personalInfo.lastName || !personalInfo.email || !personalInfo.phone) {
        setError('Please fill in all required personal information fields');
        return false;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalInfo.email)) {
        setError('Please enter a valid email address');
        return false;
      }
    } else if (currentStep === 2) {
      if (!businessInfo.businessName || !businessInfo.registrationNumber || !businessInfo.businessType) {
        setError('Please fill in all required business information fields');
        return false;
      }
    } else if (currentStep === 3) {
      if (!kybDocuments.registration || !kybDocuments.tin || !kybDocuments.proofOfAddress) {
        setError('Please upload all required documents');
        return false;
      }
    } else if (currentStep === 4) {
      if (!storeInfo.name || !storeInfo.slug || !storeInfo.description) {
        setError('Please fill in all required store information fields');
        return false;
      }
    } else if (currentStep === 5) {
      const firstProduct = products[0];
      if (!firstProduct.name || !firstProduct.sku || !firstProduct.price || !firstProduct.stock) {
        setError('Please fill in at least one product with all required fields');
        return false;
      }
    }
    return true;
  };

  const handleNext = async () => {
    if (!validateStep()) return;
    setLoading(true);
    setError(null);
    try {
      if (currentStep === 1) {
        const response = await api.onboarding.submitPersonalInfo(personalInfo);
        setAgentId(response.agent_id);
        await api.tigerbeetle.createAccount({
          user_id: response.agent_id, user_type: 'agent', initial_balance: 0
        });
      } else if (currentStep === 2) {
        await api.onboarding.submitBusinessInfo(agentId, businessInfo);
      } else if (currentStep === 3) {
        const formData = new FormData();
        Object.keys(kybDocuments).forEach(key => {
          if (kybDocuments[key]) formData.append(key, kybDocuments[key]);
        });
        formData.append('agent_id', agentId);
        await api.onboarding.uploadKYBDocuments(agentId, formData);
        await api.kyb.verifyAgent(agentId);
      } else if (currentStep === 4) {
        const storeFormData = new FormData();
        storeFormData.append('agent_id', agentId);
        storeFormData.append('name', storeInfo.name);
        storeFormData.append('description', storeInfo.description);
        storeFormData.append('slug', storeInfo.slug);
        storeFormData.append('currency', storeInfo.currency);
        storeFormData.append('payment_methods', JSON.stringify(storeInfo.paymentMethods));
        if (storeInfo.logo) storeFormData.append('logo', storeInfo.logo);
        if (storeInfo.banner) storeFormData.append('banner', storeInfo.banner);
        const response = await api.ecommerce.createStore(agentId, storeFormData);
        setStoreId(response.store_id);
      } else if (currentStep === 5) {
        for (const product of products) {
          if (product.name && product.sku && product.price) {
            const productData = {
              store_id: storeId, name: product.name, sku: product.sku,
              description: product.description, price: parseFloat(product.price),
              category: product.category, stock_quantity: parseInt(product.stock),
              weight: parseFloat(product.weight) || 0,
              variants: {
                sizes: product.sizes ? product.sizes.split(',').map(s => s.trim()) : [],
                colors: product.colors ? product.colors.split(',').map(c => c.trim()) : []
              }
            };
            await api.ecommerce.createProduct(storeId, productData);
          }
        }
      }
      setCurrentStep(currentStep + 1);
    } catch (err) {
      console.error('Error:', err);
      setError(err.response?.data?.message || err.message || 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handlePrevious = () => {
    setCurrentStep(Math.max(1, currentStep - 1));
    setError(null);
  };

  const handleFileChange = (docType, file) => {
    if (file && file.size > 5 * 1024 * 1024) {
      setError('File size must be less than 5MB');
      return;
    }
    setKybDocuments({...kybDocuments, [docType]: file});
  };

  const addProduct = () => {
    setProducts([...products, {
      name: '', sku: '', description: '', price: '', category: 'clothing',
      stock: '', weight: '', sizes: '', colors: '', images: []
    }]);
  };

  const removeProduct = (index) => {
    if (products.length > 1) setProducts(products.filter((_, i) => i !== index));
  };

  const updateProduct = (index, field, value) => {
    const newProducts = [...products];
    newProducts[index][field] = value;
    setProducts(newProducts);
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name *</Label>
                <Input id="firstName" value={personalInfo.firstName}
                  onChange={(e) => setPersonalInfo({...personalInfo, firstName: e.target.value})}
                  placeholder="John" required />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name *</Label>
                <Input id="lastName" value={personalInfo.lastName}
                  onChange={(e) => setPersonalInfo({...personalInfo, lastName: e.target.value})}
                  placeholder="Doe" required />
              </div>
            </div>
            <div>
              <Label htmlFor="email">Email *</Label>
              <Input id="email" type="email" value={personalInfo.email}
                onChange={(e) => setPersonalInfo({...personalInfo, email: e.target.value})}
                placeholder="john@example.com" required />
            </div>
            <div>
              <Label htmlFor="phone">Phone Number *</Label>
              <Input id="phone" value={personalInfo.phone}
                onChange={(e) => setPersonalInfo({...personalInfo, phone: e.target.value})}
                placeholder="+234 800 000 0000" required />
            </div>
            <div>
              <Label htmlFor="nationalId">National ID</Label>
              <Input id="nationalId" value={personalInfo.nationalId}
                onChange={(e) => setPersonalInfo({...personalInfo, nationalId: e.target.value})}
                placeholder="12345678901" />
            </div>
            <div>
              <Label htmlFor="address">Address</Label>
              <Textarea id="address" value={personalInfo.address}
                onChange={(e) => setPersonalInfo({...personalInfo, address: e.target.value})}
                placeholder="123 Main Street" rows={3} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label htmlFor="city">City</Label>
                <Input id="city" value={personalInfo.city}
                  onChange={(e) => setPersonalInfo({...personalInfo, city: e.target.value})}
                  placeholder="Lagos" />
              </div>
              <div>
                <Label htmlFor="state">State</Label>
                <Input id="state" value={personalInfo.state}
                  onChange={(e) => setPersonalInfo({...personalInfo, state: e.target.value})}
                  placeholder="Lagos State" />
              </div>
              <div>
                <Label htmlFor="country">Country</Label>
                <Input id="country" value={personalInfo.country}
                  onChange={(e) => setPersonalInfo({...personalInfo, country: e.target.value})}
                  placeholder="Nigeria" />
              </div>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="businessName">Business Name *</Label>
              <Input id="businessName" value={businessInfo.businessName}
                onChange={(e) => setBusinessInfo({...businessInfo, businessName: e.target.value})}
                placeholder="Acme Trading Ltd" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="registrationNumber">Registration Number *</Label>
                <Input id="registrationNumber" value={businessInfo.registrationNumber}
                  onChange={(e) => setBusinessInfo({...businessInfo, registrationNumber: e.target.value})}
                  placeholder="RC123456" required />
              </div>
              <div>
                <Label htmlFor="taxId">Tax ID (TIN)</Label>
                <Input id="taxId" value={businessInfo.taxId}
                  onChange={(e) => setBusinessInfo({...businessInfo, taxId: e.target.value})}
                  placeholder="12345678-0001" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="businessType">Business Type *</Label>
                <Select value={businessInfo.businessType} onValueChange={(value) => setBusinessInfo({...businessInfo, businessType: value})}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sole_proprietorship">Sole Proprietorship</SelectItem>
                    <SelectItem value="partnership">Partnership</SelectItem>
                    <SelectItem value="limited_company">Limited Company</SelectItem>
                    <SelectItem value="cooperative">Cooperative</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="industry">Industry</Label>
                <Select value={businessInfo.industry} onValueChange={(value) => setBusinessInfo({...businessInfo, industry: value})}>
                  <SelectTrigger><SelectValue placeholder="Select industry" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="retail">Retail</SelectItem>
                    <SelectItem value="wholesale">Wholesale</SelectItem>
                    <SelectItem value="manufacturing">Manufacturing</SelectItem>
                    <SelectItem value="services">Services</SelectItem>
                    <SelectItem value="agriculture">Agriculture</SelectItem>
                    <SelectItem value="technology">Technology</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="yearsInBusiness">Years in Business</Label>
              <Input id="yearsInBusiness" type="number" value={businessInfo.yearsInBusiness}
                onChange={(e) => setBusinessInfo({...businessInfo, yearsInBusiness: e.target.value})}
                placeholder="5" min="0" />
            </div>
            <div>
              <Label htmlFor="businessAddress">Business Address</Label>
              <Textarea id="businessAddress" value={businessInfo.businessAddress}
                onChange={(e) => setBusinessInfo({...businessInfo, businessAddress: e.target.value})}
                placeholder="Business location address" rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="businessPhone">Business Phone</Label>
                <Input id="businessPhone" value={businessInfo.businessPhone}
                  onChange={(e) => setBusinessInfo({...businessInfo, businessPhone: e.target.value})}
                  placeholder="+234 800 000 0001" />
              </div>
              <div>
                <Label htmlFor="businessEmail">Business Email</Label>
                <Input id="businessEmail" type="email" value={businessInfo.businessEmail}
                  onChange={(e) => setBusinessInfo({...businessInfo, businessEmail: e.target.value})}
                  placeholder="business@example.com" />
              </div>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Upload required documents for KYB verification. Documents will be processed using Multi-OCR (PaddleOCR + EasyOCR + OLMOCR) and verified through Temporal workflow orchestration. Verification typically takes 1-2 business days.
              </AlertDescription>
            </Alert>
            <div className="space-y-4">
              {[
                { key: 'registration', label: 'Business Registration Certificate' },
                { key: 'tin', label: 'Tax Identification Number (TIN)' },
                { key: 'proofOfAddress', label: 'Proof of Business Address' }
              ].map((doc) => (
                <div key={doc.key} className="border-2 border-dashed rounded-lg p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <Upload className="h-8 w-8 text-gray-400" />
                      <div>
                        <Label htmlFor={doc.key} className="cursor-pointer text-base font-medium">{doc.label}</Label>
                        <p className="text-sm text-gray-500">PDF, JPG, PNG (Max 5MB)</p>
                      </div>
                    </div>
                    <Input id={doc.key} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(e) => handleFileChange(doc.key, e.target.files[0])} />
                    <Label htmlFor={doc.key} className="cursor-pointer">
                      <Button type="button" variant="outline" asChild><span>Choose File</span></Button>
                    </Label>
                  </div>
                  {kybDocuments[doc.key] && (
                    <div className="mt-3 flex items-center text-sm text-green-600">
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      {kybDocuments[doc.key].name} ({(kybDocuments[doc.key].size / 1024).toFixed(2)} KB)
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="storeName">Store Name *</Label>
              <Input id="storeName" value={storeInfo.name}
                onChange={(e) => setStoreInfo({...storeInfo, name: e.target.value})}
                placeholder="Acme Store" required />
            </div>
            <div>
              <Label htmlFor="storeDescription">Store Description *</Label>
              <Textarea id="storeDescription" value={storeInfo.description}
                onChange={(e) => setStoreInfo({...storeInfo, description: e.target.value})}
                placeholder="Quality products at affordable prices" rows={4} required />
            </div>
            <div>
              <Label htmlFor="storeSlug">Store URL Slug *</Label>
              <Input id="storeSlug" value={storeInfo.slug}
                onChange={(e) => setStoreInfo({...storeInfo, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-')})}
                placeholder="acme-store" required />
              <p className="text-sm text-gray-500 mt-1">
                Your store will be: <strong>platform.com/store/{storeInfo.slug || 'your-slug'}</strong>
              </p>
            </div>
            <div>
              <Label htmlFor="currency">Primary Currency</Label>
              <Select value={storeInfo.currency} onValueChange={(value) => setStoreInfo({...storeInfo, currency: value})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NGN">NGN - Nigerian Naira</SelectItem>
                  <SelectItem value="USD">USD - US Dollar</SelectItem>
                  <SelectItem value="EUR">EUR - Euro</SelectItem>
                  <SelectItem value="GBP">GBP - British Pound</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Store Logo</Label>
              <div className="mt-2 border-2 border-dashed rounded-lg p-4">
                <Input type="file" accept="image/*" onChange={(e) => setStoreInfo({...storeInfo, logo: e.target.files[0]})}
                  className="hidden" id="logo-upload" />
                <Label htmlFor="logo-upload" className="cursor-pointer flex items-center justify-center">
                  <div className="text-center">
                    <Upload className="mx-auto h-8 w-8 text-gray-400 mb-2" />
                    <span className="text-sm">Click to upload logo (Recommended: 500x500px)</span>
                    {storeInfo.logo && <p className="text-sm text-green-600 mt-2">✓ {storeInfo.logo.name}</p>}
                  </div>
                </Label>
              </div>
            </div>
            <div>
              <Label>Store Banner</Label>
              <div className="mt-2 border-2 border-dashed rounded-lg p-4">
                <Input type="file" accept="image/*" onChange={(e) => setStoreInfo({...storeInfo, banner: e.target.files[0]})}
                  className="hidden" id="banner-upload" />
                <Label htmlFor="banner-upload" className="cursor-pointer flex items-center justify-center">
                  <div className="text-center">
                    <Upload className="mx-auto h-8 w-8 text-gray-400 mb-2" />
                    <span className="text-sm">Click to upload banner (Recommended: 1920x400px)</span>
                    {storeInfo.banner && <p className="text-sm text-green-600 mt-2">✓ {storeInfo.banner.name}</p>}
                  </div>
                </Label>
              </div>
            </div>
            <div>
              <Label className="mb-3 block">Payment Methods</Label>
              <div className="space-y-3">
                {[
                  { id: 'stripe', label: 'Stripe (Credit/Debit Cards)' },
                  { id: 'paypal', label: 'PayPal' },
                  { id: 'mobile_money', label: 'Mobile Money' },
                  { id: 'bank_transfer', label: 'Bank Transfer' }
                ].map((method) => (
                  <div key={method.id} className="flex items-center space-x-2">
                    <Checkbox id={method.id} checked={storeInfo.paymentMethods.includes(method.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setStoreInfo({...storeInfo, paymentMethods: [...storeInfo.paymentMethods, method.id]});
                        } else {
                          setStoreInfo({...storeInfo, paymentMethods: storeInfo.paymentMethods.filter(m => m !== method.id)});
                        }
                      }} />
                    <Label htmlFor={method.id} className="cursor-pointer font-normal">{method.label}</Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      case 5:
        return (
          <div className="space-y-6">
            {products.map((product, index) => (
              <Card key={index}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Product {index + 1}</CardTitle>
                    {products.length > 1 && (
                      <Button variant="destructive" size="sm" onClick={() => removeProduct(index)}>Remove</Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Product Name *</Label>
                      <Input value={product.name} onChange={(e) => updateProduct(index, 'name', e.target.value)}
                        placeholder="Premium T-Shirt" required />
                    </div>
                    <div>
                      <Label>SKU *</Label>
                      <Input value={product.sku} onChange={(e) => updateProduct(index, 'sku', e.target.value)}
                        placeholder="TSHIRT-001" required />
                    </div>
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea value={product.description} onChange={(e) => updateProduct(index, 'description', e.target.value)}
                      placeholder="High-quality cotton t-shirt available in multiple colors and sizes" rows={3} />
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <Label>Price *</Label>
                      <Input type="number" step="0.01" value={product.price}
                        onChange={(e) => updateProduct(index, 'price', e.target.value)} placeholder="29.99" required />
                    </div>
                    <div>
                      <Label>Category</Label>
                      <Select value={product.category} onValueChange={(value) => updateProduct(index, 'category', value)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="clothing">Clothing</SelectItem>
                          <SelectItem value="electronics">Electronics</SelectItem>
                          <SelectItem value="home_garden">Home & Garden</SelectItem>
                          <SelectItem value="sports">Sports</SelectItem>
                          <SelectItem value="food_beverage">Food & Beverage</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Stock *</Label>
                      <Input type="number" value={product.stock} onChange={(e) => updateProduct(index, 'stock', e.target.value)}
                        placeholder="100" required />
                    </div>
                    <div>
                      <Label>Weight (kg)</Label>
                      <Input type="number" step="0.01" value={product.weight}
                        onChange={(e) => updateProduct(index, 'weight', e.target.value)} placeholder="0.25" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Sizes (comma-separated)</Label>
                      <Input value={product.sizes} onChange={(e) => updateProduct(index, 'sizes', e.target.value)}
                        placeholder="S, M, L, XL" />
                      {product.sizes && <p className="text-xs text-gray-500 mt-1">{product.sizes.split(',').length} size(s)</p>}
                    </div>
                    <div>
                      <Label>Colors (comma-separated)</Label>
                      <Input value={product.colors} onChange={(e) => updateProduct(index, 'colors', e.target.value)}
                        placeholder="Red, Blue, Green, Black" />
                      {product.colors && <p className="text-xs text-gray-500 mt-1">{product.colors.split(',').length} color(s)</p>}
                    </div>
                  </div>
                  {product.sizes && product.colors && (
                    <Alert>
                      <AlertDescription>
                        This will generate <strong>{product.sizes.split(',').length * product.colors.split(',').length} variants</strong>
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            ))}
            <Button variant="outline" onClick={addProduct} className="w-full">+ Add Another Product</Button>
          </div>
        );

      case 6:
        return (
          <div className="text-center space-y-6 py-8">
            <CheckCircle2 className="mx-auto h-24 w-24 text-green-500 animate-pulse" />
            <div>
              <h2 className="text-3xl font-bold mb-2">Congratulations!</h2>
              <p className="text-gray-600 text-lg">Your agent account has been successfully created</p>
            </div>
            <Alert className="text-left">
              <AlertDescription>
                <strong className="block mb-2">What's Next?</strong>
                <ul className="list-disc list-inside space-y-1">
                  <li>KYB verification is in progress (1-2 business days)</li>
                  <li>Your store is live at: <strong className="text-purple-600">platform.com/store/{storeInfo.slug}</strong></li>
                  <li>You can start managing products and orders immediately</li>
                  <li>Payment processing will be enabled after verification</li>
                  <li>TigerBeetle account created for financial tracking</li>
                </ul>
              </AlertDescription>
            </Alert>
            <div className="grid grid-cols-2 gap-4 mt-6 max-w-2xl mx-auto">
              <Card>
                <CardContent className="pt-6 text-center">
                  <Store className="mx-auto h-12 w-12 text-purple-600 mb-3" />
                  <h3 className="font-semibold text-lg mb-1">Store Created</h3>
                  <p className="text-sm text-gray-600">{storeInfo.name}</p>
                  <p className="text-xs text-gray-500 mt-1">{storeInfo.paymentMethods.length} payment methods</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6 text-center">
                  <Package className="mx-auto h-12 w-12 text-purple-600 mb-3" />
                  <h3 className="font-semibold text-lg mb-1">Products Added</h3>
                  <p className="text-sm text-gray-600">{products.length} product(s)</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {products.reduce((sum, p) => sum + (p.sizes && p.colors ? p.sizes.split(',').length * p.colors.split(',').length : 1), 0)} total variants
                  </p>
                </CardContent>
              </Card>
            </div>
            <div className="flex gap-4 justify-center mt-8">
              <Button size="lg" onClick={() => window.location.href = '/dashboard'} className="px-8">Go to Dashboard →</Button>
              <Button size="lg" variant="outline" onClick={() => window.location.href = `/store/${storeInfo.slug}`} className="px-8">View Store</Button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-6 pb-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Agent Onboarding</h1>
        <p className="text-gray-600">Complete your registration to start selling</p>
      </div>
      <div className="mb-8">
        <div className="flex justify-between mb-4">
          {STEPS.map((step) => (
            <div key={step.id} className="flex flex-col items-center flex-1">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl transition-all ${
                currentStep > step.id ? 'bg-green-500 text-white' :
                currentStep === step.id ? 'bg-purple-600 text-white shadow-lg scale-110' :
                'bg-gray-200 text-gray-500'
              }`}>
                {currentStep > step.id ? '✓' : step.icon}
              </div>
              <span className={`text-xs mt-2 text-center font-medium ${
                currentStep === step.id ? 'text-purple-600' : 'text-gray-600'
              }`}>{step.title}</span>
            </div>
          ))}
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
          <div className="bg-gradient-to-r from-purple-600 to-purple-400 h-3 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${(currentStep / STEPS.length) * 100}%` }} />
        </div>
        <p className="text-center text-sm text-gray-600 mt-2 font-medium">
          Step {currentStep} of {STEPS.length} • {Math.round((currentStep / STEPS.length) * 100)}% complete
        </p>
      </div>
      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-2xl">{STEPS[currentStep - 1].title}</CardTitle>
          <CardDescription className="text-base">
            {currentStep === 1 && 'Enter your personal information to create your agent account'}
            {currentStep === 2 && 'Provide your business details for verification'}
            {currentStep === 3 && 'Upload required documents for KYB verification'}
            {currentStep === 4 && 'Set up your online store with payment methods'}
            {currentStep === 5 && 'Add your first products with variants'}
            {currentStep === 6 && 'Your account is ready to start selling!'}
          </CardDescription>
        </CardHeader>
        <CardContent>{renderStep()}</CardContent>
      </Card>
      {currentStep < 6 && (
        <div className="flex justify-between mt-6">
          <Button variant="outline" onClick={handlePrevious} disabled={currentStep === 1 || loading} size="lg">← Previous</Button>
          <Button onClick={handleNext} disabled={loading} size="lg" className="px-8">
            {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing...</>) : (currentStep === 5 ? 'Complete Setup →' : 'Next →')}
          </Button>
        </div>
      )}
    </div>
  );
}

