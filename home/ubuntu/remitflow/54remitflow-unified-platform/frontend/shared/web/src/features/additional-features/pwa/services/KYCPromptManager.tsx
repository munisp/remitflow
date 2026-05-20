import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
import { createPortal } from 'react-dom';

// --- Configuration and Constants ---

/**
 * @constant {string} API_BASE_URL - Base URL for the KYC service API.
 * In a real application, this would be loaded from environment variables.
 */
const API_BASE_URL = '/api/v1/kyc';

/**
 * @constant {number} WARNING_THRESHOLD_PERCENTAGE - The percentage of the limit
 * at which the warning prompt should be triggered.
 */
const WARNING_THRESHOLD_PERCENTAGE = 0.8;

// --- Type Definitions ---

/**
 * @typedef {'PENDING' | 'VERIFIED' | 'REJECTED' | 'REQUIRED'} KYCStatus
 * Represents the current KYC verification status of the user.
 */
type KYCStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'REQUIRED';

/**
 * @interface UserKYCData
 * Defines the structure for the user's KYC and limit information.
 */
interface UserKYCData {
  status: KYCStatus;
  currentLimit: number; // e.g., monthly transaction limit
  usedAmount: number;
  limitCurrency: string;
  nextUpgradeLevel: string;
  upgradeLink: string;
}

/**
 * @interface PromptContent
 * Defines the content for the modal prompt.
 */
interface PromptContent {
  title: string;
  message: string;
  primaryButtonText: string;
  secondaryButtonText?: string;
  onPrimaryAction: () => void;
  onSecondaryAction?: () => void;
}

/**
 * @interface KYCPromptManagerContextType
 * Defines the shape of the context provided by the KYCPromptManagerProvider.
 */
interface KYCPromptManagerContextType {
  /**
   * @method showUpgradePrompt
   * Displays the modal prompt for a mandatory KYC upgrade.
   * @param {string} reason - The reason for the mandatory upgrade.
   * @returns {Promise<void>}
   */
  showUpgradePrompt: (reason: string) => Promise<void>;
  /**
   * @method showLimitWarning
   * Displays a warning prompt if the user is approaching their transaction limit.
   * @returns {Promise<boolean>} - Resolves to true if a warning was shown, false otherwise.
   */
  showLimitWarning: () => Promise<boolean>;
  /**
   * @method isPromptVisible
   * Returns the current visibility state of the modal.
   * @returns {boolean}
   */
  isPromptVisible: boolean;
}

// Default context value for safety
const KYCPromptManagerContext = createContext<KYCPromptManagerContextType | undefined>(undefined);

// --- API Simulation/Abstraction ---

/**
 * @function fetchUserKYCData
 * Simulates an asynchronous API call to fetch the user's KYC data.
 * @returns {Promise<UserKYCData>}
 */
const fetchUserKYCData = async (): Promise<UserKYCData> => {
  // In a real application, this would use 'fetch' or an API client like Axios.
  console.log(`[KYC API] Fetching data from ${API_BASE_URL}/status...`);
  await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay

  // Mock data for demonstration
  const mockData: UserKYCData = {
    status: 'REQUIRED', // 'REQUIRED' or 'VERIFIED' for testing
    currentLimit: 5000,
    usedAmount: 4200, // 84% usage
    limitCurrency: 'USD',
    nextUpgradeLevel: 'Level 2 (Increased Limits)',
    upgradeLink: '/settings/kyc-upgrade',
  };

  if (Math.random() < 0.1) {
    // Simulate an API error 10% of the time
    throw new Error('Failed to fetch KYC data due to server error.');
  }

  return mockData;
};

/**
 * @function logPromptImpression
 * Simulates logging the fact that a prompt was shown to the backend.
 * @param {string} type - The type of prompt shown (e.g., 'UPGRADE', 'WARNING').
 * @returns {Promise<void>}
 */
const logPromptImpression = async (type: 'UPGRADE' | 'WARNING'): Promise<void> => {
  console.log(`[KYC API] Logging prompt impression: ${type}`);
  await new Promise(resolve => setTimeout(resolve, 100));
};

// --- Modal Component ---

/**
 * @interface KYCPromptModalProps
 * Props for the presentation component of the KYC prompt modal.
 */
interface KYCPromptModalProps {
  content: PromptContent;
  onClose: () => void;
}

/**
 * @component KYCPromptModal
 * A generic, production-ready modal component for displaying KYC prompts.
 * Uses `createPortal` to render outside the main React tree for better z-index management.
 * @param {KYCPromptModalProps} props - The component props.
 * @returns {React.ReactPortal | null}
 */
const KYCPromptModal: React.FC<KYCPromptModalProps> = ({ content, onClose }) => {
  const modalRoot = document.getElementById('modal-root');
  if (!modalRoot) {
    console.error('Modal root element not found. Ensure <div id="modal-root"> exists in index.html.');
    return null;
  }

  const handlePrimaryClick = () => {
    content.onPrimaryAction();
    onClose();
  };

  const handleSecondaryClick = () => {
    if (content.onSecondaryAction) {
      content.onSecondaryAction();
    }
    onClose();
  };

  // Basic accessibility and keyboard handling
  React.useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const ModalContent = (
    <div className="kyc-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="kyc-modal-title">
      <div className="kyc-modal-container">
        <div className="kyc-modal-header">
          <h2 id="kyc-modal-title">{content.title}</h2>
          <button className="kyc-modal-close-btn" onClick={onClose} aria-label="Close modal">
            &times;
          </button>
        </div>
        <div className="kyc-modal-body">
          <p>{content.message}</p>
        </div>
        <div className="kyc-modal-footer">
          {content.secondaryButtonText && (
            <button className="kyc-modal-secondary-btn" onClick={handleSecondaryClick}>
              {content.secondaryButtonText}
            </button>
          )}
          <button className="kyc-modal-primary-btn" onClick={handlePrimaryClick}>
            {content.primaryButtonText}
          </button>
        </div>
      </div>
      {/* Basic CSS for the modal - would be in a separate CSS file in production */}
      <style jsx="true">{`
        .kyc-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0, 0, 0, 0.6);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000; /* High z-index */
        }
        .kyc-modal-container {
          background: white;
          border-radius: 8px;
          padding: 24px;
          width: 90%;
          max-width: 450px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          color: #333;
        }
        .kyc-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }
        .kyc-modal-header h2 {
          margin: 0;
          font-size: 1.5rem;
          color: #0056b3;
        }
        .kyc-modal-close-btn {
          background: none;
          border: none;
          font-size: 1.5rem;
          cursor: pointer;
          color: #aaa;
        }
        .kyc-modal-body p {
          line-height: 1.5;
          margin-bottom: 24px;
        }
        .kyc-modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }
        .kyc-modal-primary-btn, .kyc-modal-secondary-btn {
          padding: 10px 20px;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
          transition: background-color 0.2s;
        }
        .kyc-modal-primary-btn {
          background-color: #007bff;
          color: white;
          border: 1px solid #007bff;
        }
        .kyc-modal-primary-btn:hover {
          background-color: #0056b3;
        }
        .kyc-modal-secondary-btn {
          background-color: white;
          color: #007bff;
          border: 1px solid #007bff;
        }
        .kyc-modal-secondary-btn:hover {
          background-color: #f0f0f0;
        }
      `}</style>
    </div>
  );

  return createPortal(ModalContent, modalRoot);
};

// --- Custom Hook (The Core Logic) ---

/**
 * @function useKYCPromptManager
 * Custom hook that provides the core logic for managing and displaying KYC prompts.
 * @returns {KYCPromptManagerContextType}
 */
const useKYCPromptManager = (): KYCPromptManagerContextType => {
  const [isPromptVisible, setIsPromptVisible] = useState(false);
  const [promptContent, setPromptContent] = useState<PromptContent | null>(null);
  const [kycData, setKycData] = useState<UserKYCData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * @method fetchAndSetKYCData
   * Fetches the latest KYC data from the backend and updates the state.
   * @returns {Promise<UserKYCData>} - The fetched data.
   */
  const fetchAndSetKYCData = useCallback(async (): Promise<UserKYCData> => {
    setIsLoading(true);
    try {
      const data = await fetchUserKYCData();
      setKycData(data);
      return data;
    } catch (error) {
      console.error('Error fetching KYC data:', error);
      // Fallback data on error to prevent app crash
      const errorData: UserKYCData = {
        status: 'REQUIRED',
        currentLimit: 0,
        usedAmount: 0,
        limitCurrency: 'N/A',
        nextUpgradeLevel: 'N/A',
        upgradeLink: '/error-page',
      };
      setKycData(errorData);
      throw new Error('KYC service is temporarily unavailable. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * @method closeModal
   * Closes the currently visible modal.
   */
  const closeModal = useCallback(() => {
    setIsPromptVisible(false);
    setPromptContent(null);
  }, []);

  /**
   * @method navigateToUpgrade
   * Simulates navigation to the KYC upgrade page.
   */
  const navigateToUpgrade = useCallback((link: string) => {
    console.log(`[Navigation] Redirecting user to KYC upgrade page: ${link}`);
    // In a real app, this would be a router call, e.g., history.push(link)
    // window.location.href = link;
  }, []);

  /**
   * @method showUpgradePrompt
   * Public method to display a mandatory upgrade prompt.
   * @param {string} reason - The reason for the mandatory upgrade.
   * @returns {Promise<void>}
   */
  const showUpgradePrompt = useCallback(async (reason: string): Promise<void> => {
    if (isPromptVisible || isLoading) return;

    let data: UserKYCData;
    try {
      data = kycData || await fetchAndSetKYCData();
    } catch (error) {
      // Handle the error from fetchAndSetKYCData gracefully
      alert(`Error: ${error instanceof Error ? error.message : 'An unknown error occurred.'}`);
      return;
    }

    if (data.status === 'VERIFIED') {
      console.log('KYC already verified. No upgrade prompt needed.');
      return;
    }

    const content: PromptContent = {
      title: 'Action Required: Complete Your KYC',
      message: `Your account requires a KYC upgrade to continue using our services. Reason: ${reason}. The next level is ${data.nextUpgradeLevel}.`,
      primaryButtonText: 'Start Upgrade Now',
      onPrimaryAction: () => {
        logPromptImpression('UPGRADE');
        navigateToUpgrade(data.upgradeLink);
      },
      secondaryButtonText: 'Later',
      onSecondaryAction: () => {
        // Log dismissal but allow user to continue for now (if not strictly blocked)
        console.log('User dismissed upgrade prompt.');
      },
    };

    setPromptContent(content);
    setIsPromptVisible(true);
  }, [isPromptVisible, isLoading, kycData, fetchAndSetKYCData, navigateToUpgrade]);

  /**
   * @method showLimitWarning
   * Public method to display a limit warning prompt if threshold is met.
   * @returns {Promise<boolean>} - True if a warning was shown, false otherwise.
   */
  const showLimitWarning = useCallback(async (): Promise<boolean> => {
    if (isPromptVisible || isLoading) return false;

    let data: UserKYCData;
    try {
      data = kycData || await fetchAndSetKYCData();
    } catch (error) {
      console.error('Could not check limits due to KYC data fetch error.');
      return false;
    }

    const usageRatio = data.usedAmount / data.currentLimit;

    if (usageRatio >= WARNING_THRESHOLD_PERCENTAGE && data.status !== 'VERIFIED') {
      const remaining = data.currentLimit - data.usedAmount;
      const percentage = Math.round(usageRatio * 100);

      const content: PromptContent = {
        title: 'Approaching Transaction Limit',
        message: `You have used ${percentage}% of your current ${data.limitCurrency} limit. Only ${remaining.toFixed(2)} ${data.limitCurrency} remains. Upgrade your KYC to increase your limits.`,
        primaryButtonText: 'Increase Limits',
        onPrimaryAction: () => {
          logPromptImpression('WARNING');
          navigateToUpgrade(data.upgradeLink);
        },
        secondaryButtonText: 'I Understand',
        onSecondaryAction: () => {
          console.log('User acknowledged limit warning.');
        },
      };

      setPromptContent(content);
      setIsPromptVisible(true);
      return true;
    }

    console.log('Limit warning not required or KYC is fully verified.');
    return false;
  }, [isPromptVisible, isLoading, kycData, fetchAndSetKYCData, navigateToUpgrade]);

  // Expose only the necessary public methods and state
  const contextValue = useMemo(() => ({
    showUpgradePrompt,
    showLimitWarning,
    isPromptVisible,
  }), [showUpgradePrompt, showLimitWarning, isPromptVisible]);

  return contextValue;
};

// --- Provider Component ---

/**
 * @interface KYCPromptManagerProviderProps
 * Props for the provider component.
 */
interface KYCPromptManagerProviderProps {
  children: ReactNode;
}

/**
 * @component KYCPromptManagerProvider
 * Provides the KYC prompt management context to the application.
 * Renders the modal if a prompt is active.
 * @param {KYCPromptManagerProviderProps} props - The component props.
 * @returns {JSX.Element}
 */
export const KYCPromptManagerProvider: React.FC<KYCPromptManagerProviderProps> = ({ children }) => {
  const manager = useKYCPromptManager();

  return (
    <KYCPromptManagerContext.Provider value={manager}>
      {children}
      {manager.isPromptVisible && manager.promptContent && (
        <KYCPromptModal
          content={manager.promptContent}
          onClose={manager.closeModal} // Accessing internal method via the hook's closure
        />
      )}
    </KYCPromptManagerContext.Provider>
  );
};

// --- Public Hook for Consumers ---

/**
 * @function useKYCPrompts
 * Public hook for consuming the KYCPromptManager context.
 * Use this hook in any component that needs to trigger a KYC prompt.
 * @returns {KYCPromptManagerContextType}
 * @throws {Error} If used outside of a KYCPromptManagerProvider.
 */
export const useKYCPrompts = (): KYCPromptManagerContextType => {
  const context = useContext(KYCPromptManagerContext);
  if (context === undefined) {
    throw new Error('useKYCPrompts must be used within a KYCPromptManagerProvider');
  }
  return context;
};

// Export the main components and hooks
export default useKYCPrompts;
// export { KYCPromptManagerProvider, useKYCPrompts }; // Alternative named exports
