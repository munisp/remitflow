import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import AgentEcommerceDashboard from '../agent-ecommerce/AgentEcommerceDashboard';
import AgentBankingDashboard from '../agent-management/AgentPerformance'; // Assuming this is the banking dashboard

const UnifiedDashboard = ({ agentId }) => {
    const [activeTab, setActiveTab] = useState('banking');

    const tabs = [
        { id: 'banking', label: 'Banking Operations' },
        { id: 'ecommerce', label: 'E-commerce Dashboard' },
    ];

    return (
        <div className="p-6 bg-gray-100 min-h-screen">
            <h1 className="text-3xl font-bold mb-6">Unified Agent Dashboard</h1>

            <div className="mb-6 border-b border-gray-200">
                <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`${activeTab === tab.id
                                    ? 'border-indigo-500 text-indigo-600'
                                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>
            </div>

            <AnimatePresence mode="wait">
                <motion.div
                    key={activeTab}
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -10, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                >
                    {activeTab === 'banking' && <AgentBankingDashboard agentId={agentId} />}
                    {activeTab === 'ecommerce' && <AgentEcommerceDashboard agentId={agentId} />}
                </motion.div>
            </AnimatePresence>
        </div>
    );
};

export default UnifiedDashboard;

