import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button.jsx'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.jsx'
import { Input } from '@/components/ui/input.jsx'
import { Label } from '@/components/ui/label.jsx'
import { Textarea } from '@/components/ui/textarea.jsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs.jsx'
import { Badge } from '@/components/ui/badge.jsx'
import { CreditCard, Smartphone, Banknote, QrCode } from 'lucide-react'
import { useCart } from './CartContext'

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN'
  }).format(amount)
}

export default function CheckoutFlow() {
  const navigate = useNavigate()
  const { cart, getCartTotal, clearCart } = useCart()
  const [currentStep, setCurrentStep] = useState(1)
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    email: '',
    address: '',
    paymentMethod: 'qr_code'
  })
  
  const subtotal = getCartTotal()
  const deliveryFee = subtotal >= 10000 ? 0 : 1500
  const total = subtotal + deliveryFee
  
  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    })
  }
  
  const handleNextStep = () => {
    setCurrentStep(currentStep + 1)
  }
  
  const handlePrevStep = () => {
    setCurrentStep(currentStep - 1)
  }
  
  const handlePlaceOrder = () => {
    // In production, this would call the API
    console.log('Order placed:', { formData, cart, total })
    clearCart()
    navigate('/shop/order-success')
  }
  
  if (cart.length === 0) {
    return (
      <div className="container mx-auto px-4 py-12 text-center">
        <h2 className="text-2xl font-bold mb-4">Your cart is empty</h2>
        <Button onClick={() => navigate('/shop')}>Continue Shopping</Button>
      </div>
    )
  }
  
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto px-4">
        <h1 className="text-3xl font-bold mb-8">Checkout</h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Checkout Form */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 1 ? 'bg-primary text-white' : 'bg-gray-200'}`}>
                      1
                    </div>
                    <span className="font-semibold">Contact</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 2 ? 'bg-primary text-white' : 'bg-gray-200'}`}>
                      2
                    </div>
                    <span className="font-semibold">Delivery</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${currentStep >= 3 ? 'bg-primary text-white' : 'bg-gray-200'}`}>
                      3
                    </div>
                    <span className="font-semibold">Payment</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Step 1: Contact Information */}
                {currentStep === 1 && (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="fullName">Full Name</Label>
                      <Input
                        id="fullName"
                        name="fullName"
                        value={formData.fullName}
                        onChange={handleInputChange}
                        placeholder="John Doe"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="phone">Phone Number</Label>
                      <Input
                        id="phone"
                        name="phone"
                        type="tel"
                        value={formData.phone}
                        onChange={handleInputChange}
                        placeholder="+234 803 123 4567"
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="email">Email (Optional)</Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        value={formData.email}
                        onChange={handleInputChange}
                        placeholder="john@example.com"
                      />
                    </div>
                    <Button className="w-full" onClick={handleNextStep}>
                      Continue to Delivery
                    </Button>
                  </div>
                )}
                
                {/* Step 2: Delivery Address */}
                {currentStep === 2 && (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="address">Delivery Address</Label>
                      <Textarea
                        id="address"
                        name="address"
                        value={formData.address}
                        onChange={handleInputChange}
                        placeholder="Enter your full delivery address"
                        rows={4}
                        required
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="w-full" onClick={handlePrevStep}>
                        Back
                      </Button>
                      <Button className="w-full" onClick={handleNextStep}>
                        Continue to Payment
                      </Button>
                    </div>
                  </div>
                )}
                
                {/* Step 3: Payment Method */}
                {currentStep === 3 && (
                  <div className="space-y-4">
                    <div>
                      <Label>Payment Method</Label>
                      <Tabs value={formData.paymentMethod} onValueChange={(value) => setFormData({ ...formData, paymentMethod: value })}>
                        <TabsList className="grid w-full grid-cols-3">
                          <TabsTrigger value="qr_code">QR Code</TabsTrigger>
                          <TabsTrigger value="mobile_money">Mobile Money</TabsTrigger>
                          <TabsTrigger value="cash">Cash</TabsTrigger>
                        </TabsList>
                        <TabsContent value="qr_code" className="mt-4">
                          <Card>
                            <CardContent className="pt-6">
                              <div className="flex flex-col items-center gap-4">
                                <QrCode className="w-32 h-32 text-muted-foreground" />
                                <p className="text-sm text-muted-foreground text-center">
                                  Scan this QR code with your mobile banking app to complete payment
                                </p>
                              </div>
                            </CardContent>
                          </Card>
                        </TabsContent>
                        <TabsContent value="mobile_money" className="mt-4">
                          <Card>
                            <CardContent className="pt-6">
                              <div className="flex flex-col items-center gap-4">
                                <Smartphone className="w-16 h-16 text-muted-foreground" />
                                <p className="text-sm text-muted-foreground text-center">
                                  You'll receive a payment prompt on your phone
                                </p>
                              </div>
                            </CardContent>
                          </Card>
                        </TabsContent>
                        <TabsContent value="cash" className="mt-4">
                          <Card>
                            <CardContent className="pt-6">
                              <div className="flex flex-col items-center gap-4">
                                <Banknote className="w-16 h-16 text-muted-foreground" />
                                <p className="text-sm text-muted-foreground text-center">
                                  Pay with cash when your order is delivered
                                </p>
                              </div>
                            </CardContent>
                          </Card>
                        </TabsContent>
                      </Tabs>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" className="w-full" onClick={handlePrevStep}>
                        Back
                      </Button>
                      <Button className="w-full" onClick={handlePlaceOrder}>
                        Place Order
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
          
          {/* Order Summary */}
          <div>
            <Card>
              <CardHeader>
                <CardTitle>Order Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {cart.map(item => (
                  <div key={item.id} className="flex gap-3">
                    <img 
                      src={item.images[0]} 
                      alt={item.name}
                      className="w-16 h-16 object-cover rounded"
                    />
                    <div className="flex-1">
                      <p className="font-semibold text-sm line-clamp-2">{item.name}</p>
                      <p className="text-sm text-muted-foreground">Qty: {item.quantity}</p>
                      <p className="text-sm font-semibold">{formatCurrency(item.base_price * item.quantity)}</p>
                    </div>
                  </div>
                ))}
                
                <div className="border-t pt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Subtotal:</span>
                    <span>{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Delivery:</span>
                    <span>{deliveryFee === 0 ? 'FREE' : formatCurrency(deliveryFee)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg border-t pt-2">
                    <span>Total:</span>
                    <span>{formatCurrency(total)}</span>
                  </div>
                </div>
                
                {subtotal >= 10000 && (
                  <Badge className="w-full justify-center" variant="secondary">
                    🎉 You qualify for free delivery!
                  </Badge>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

