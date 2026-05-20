import React, { useState } from 'react';
import { motion } from 'framer-motion';
import CustomerOnboarding from '../customer-management/CustomerOnboarding';
import POSIntegration from '../pos-integration/POSIntegration';

const IntegratedOnboarding = ({ agentId, storeId }) => {
    const [onboardingComplete, setOnboardingComplete] = useState(false);

    const handleOnboardingComplete = () => {
        setOnboardingComplete(true);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="p-6 bg-gray-100 min-h-screen"
        >
            <h1 className="text-3xl font-bold mb-6 text-center">Welcome! Let's Get You Started</h1>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-6 rounded-lg shadow-md">
                    <h2 className="text-2xl font-bold mb-4">1. Complete Your Banking Profile</h2>
                    <CustomerOnboarding onComplete={handleOnboardingComplete} />
                </div>

                <motion.div 
                    initial={{ opacity: 0.5, scale: 0.9 }}
                    animate={{ opacity: onboardingComplete ? 1 : 0.5, scale: onboardingComplete ? 1 : 0.9 }}
                    transition={{ duration: 0.3 }}
                    className={`bg-white p-6 rounded-lg shadow-md ${!onboardingComplete && 'pointer-events-none'}`}
                >
                    <h2 className="text-2xl font-bold mb-4">2. Explore Our Products</h2>
                    {onboardingComplete ? (
                        <POSIntegration storeId={storeId} />
                    ) : (
                        <div className="text-center text-gray-500">Complete your banking profile to unlock shopping.</div>
                    )}
                </motion.div>
            </div>
        </motion.div>
    );
};

export default IntegratedOnboarding;

