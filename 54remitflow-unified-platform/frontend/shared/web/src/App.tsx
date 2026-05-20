import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from 'react-query';
import { Provider } from 'react-redux';
import { store } from './store';

// Import all 66 components
import CreateDispute from '../../src/components/disputes_refunds/CreateDispute';
import DisputeDetails from '../../src/components/disputes_refunds/DisputeDetails';
import DisputeResolution from '../../src/components/disputes_refunds/DisputeResolution';
import DisputesList from '../../src/components/disputes_refunds/DisputesList';
import RefundDetails from '../../src/components/disputes_refunds/RefundDetails';
import RefundsList from '../../src/components/disputes_refunds/RefundsList';
import CreateRecurringPayment from '../../src/components/recurring_payments/CreateRecurringPayment';
import EditRecurringPayment from '../../src/components/recurring_payments/EditRecurringPayment';
import RecurringPaymentDetails from '../../src/components/recurring_payments/RecurringPaymentDetails';
import RecurringPaymentHistory from '../../src/components/recurring_payments/RecurringPaymentHistory';
import RecurringPaymentSettings from '../../src/components/recurring_payments/RecurringPaymentSettings';
import RecurringPaymentsList from '../../src/components/recurring_payments/RecurringPaymentsList';
import ReferralDashboard from '../../src/components/referral_rewards/ReferralDashboard';
import ReferralLink from '../../src/components/referral_rewards/ReferralLink';
import ReferralStats from '../../src/components/referral_rewards/ReferralStats';
import ReferralsList from '../../src/components/referral_rewards/ReferralsList';
import RewardDetails from '../../src/components/referral_rewards/RewardDetails';
import RewardRedemption from '../../src/components/referral_rewards/RewardRedemption';
import RewardsList from '../../src/components/referral_rewards/RewardsList';
import AutoSaveSettings from '../../src/components/savings_investment/AutoSaveSettings';
import CreateSavingsGoal from '../../src/components/savings_investment/CreateSavingsGoal';
import InvestmentDetails from '../../src/components/savings_investment/InvestmentDetails';
import InvestmentOpportunities from '../../src/components/savings_investment/InvestmentOpportunities';
import InvestmentPerformance from '../../src/components/savings_investment/InvestmentPerformance';
import InvestmentPortfolio from '../../src/components/savings_investment/InvestmentPortfolio';
import SavingsGoalDetails from '../../src/components/savings_investment/SavingsGoalDetails';
import SavingsGoalProgress from '../../src/components/savings_investment/SavingsGoalProgress';
import SavingsGoalsList from '../../src/components/savings_investment/SavingsGoalsList';
import { UPIPayment } from './features/upi/UPIPayment';
import { MultiCurrencyWallet } from './features/multi-currency/MultiCurrencyWallet';

const queryClient = new QueryClient();

const componentMap: { [key: string]: React.FC } = {
  CreateDispute, DisputeDetails, DisputeResolution, DisputesList, RefundDetails, RefundsList,
  CreateRecurringPayment, EditRecurringPayment, RecurringPaymentDetails, RecurringPaymentHistory, RecurringPaymentSettings, RecurringPaymentsList,
  ReferralDashboard, ReferralLink, ReferralStats, ReferralsList, RewardDetails, RewardRedemption, RewardsList,
  AutoSaveSettings, CreateSavingsGoal, InvestmentDetails, InvestmentOpportunities, InvestmentPerformance, InvestmentPortfolio, SavingsGoalDetails, SavingsGoalProgress, SavingsGoalsList,
  UPIPayment, MultiCurrencyWallet
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <Router>
          <div className="min-h-screen bg-gray-100 p-4">
            <nav className="mb-4">
              <h1 className="text-2xl font-bold mb-2">RemitFlow PWA</h1>
              <div className="grid grid-cols-4 gap-2">
                {Object.keys(componentMap).map(name => (
                  <Link key={name} to={`/${name.toLowerCase()}`} className="text-blue-500 hover:underline">{name}</Link>
                ))}
              </div>
            </nav>
            <Routes>
              {Object.entries(componentMap).map(([name, Component]) => (
                <Route key={name} path={`/${name.toLowerCase()}`} element={<Component />} />
              ))}
            </Routes>
          </div>
        </Router>
      </Provider>
    </QueryClientProvider>
  );
};
