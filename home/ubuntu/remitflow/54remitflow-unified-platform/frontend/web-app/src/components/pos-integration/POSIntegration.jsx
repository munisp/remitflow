import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const POSIntegration = ({ storeId }) => {
    const [posData, setPosData] = useState(null);
    const [cart, setCart] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchPOSData = async () => {
            try {
                const response = await fetch(`http://localhost:8010/pos/integration/${storeId}`);
                if (!response.ok) {
                    throw new Error('Failed to fetch POS data');
                }
                const data = await response.json();
                setPosData(data);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchPOSData();
    }, [storeId]);

    const addToCart = (product) => {
        setCart([...cart, { ...product, quantity: 1 }]);
    };

    const calculateTotal = () => {
        return cart.reduce((total, item) => total + item.price * item.quantity, 0);
    };

    if (loading) {
        return <div className="flex justify-center items-center h-screen">Loading...</div>;
    }

    if (error) {
        return <div className="text-red-500 text-center mt-10">Error: {error}</div>;
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="p-6 bg-gray-100 min-h-screen grid grid-cols-1 md:grid-cols-3 gap-6"
        >
            <div className="md:col-span-2 bg-white p-6 rounded-lg shadow-md">
                <h2 className="text-2xl font-bold mb-4">Products</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {posData && posData.products.map(product => (
                        <div key={product.id} className="border rounded-lg p-4 flex flex-col">
                            <h3 className="text-lg font-medium">{product.name}</h3>
                            <p className="text-gray-500">${product.price.toFixed(2)}</p>
                            <button 
                                onClick={() => addToCart(product)}
                                className="mt-auto bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700"
                            >
                                Add to Cart
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-md">
                <h2 className="text-2xl font-bold mb-4">Cart</h2>
                <div className="divide-y divide-gray-200">
                    {cart.map((item, index) => (
                        <div key={index} className="py-4 flex justify-between items-center">
                            <div>
                                <p className="font-medium">{item.name}</p>
                                <p className="text-sm text-gray-500">${item.price.toFixed(2)} x {item.quantity}</p>
                            </div>
                            <p className="font-medium">${(item.price * item.quantity).toFixed(2)}</p>
                        </div>
                    ))}
                </div>
                <div className="mt-6 pt-6 border-t border-gray-200">
                    <div className="flex justify-between items-center">
                        <p className="text-lg font-medium">Total</p>
                        <p className="text-lg font-medium">${calculateTotal().toFixed(2)}</p>
                    </div>
                    <button className="mt-6 w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700">Checkout</button>
                </div>
            </div>
        </motion.div>
    );
};

export default POSIntegration;

