import React from 'react';

interface StatCardProps {
  title: string;
  value: number | string;
  icon?: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
}

export const StatCard: React.FC<StatCardProps> = ({ title, value, icon, trend }) => {
  return (
    <div className="stat-card bg-white p-6 rounded-lg shadow">
      <div className="flex items-center justify-between mb-2">
        {icon && <span className="text-2xl">{icon}</span>}
        <h3 className="text-gray-600">{title}</h3>
      </div>
      <div className="text-3xl font-bold">{value}</div>
      {trend && (
        <div className={`text-sm mt-2 ${
          trend === 'up' ? 'text-green-600' : 
          trend === 'down' ? 'text-red-600' : 
          'text-gray-600'
        }`}>
          {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
        </div>
      )}
    </div>
  );
};
