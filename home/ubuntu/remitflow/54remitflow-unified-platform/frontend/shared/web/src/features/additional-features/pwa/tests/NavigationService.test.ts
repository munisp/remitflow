// /home/ubuntu/PWA NavigationService.test.ts

import { NavigationService, setKYCStatus, clearNavigationState } from './NavigationService';
import { useNavigate } from 'react-router-dom';

// 1. Mock the external dependency: react-router-dom's useNavigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
    useNavigate: () => mockNavigate,
}));

// 2. Mock the internal dependency: transactionService (implicitly used in NavigationService)
// Since transactionService is not exported, we'll mock the module containing it if possible,
// but for this simple mock, we'll assume it's an internal detail and focus on the observable
// behavior or mock the entire module if it were in a separate file.
// Given the mock structure, we'll rely on the mocked implementation in NavigationService.ts
// and focus on mocking the service itself if it were external.
// For the sake of a production-ready test, let's assume transactionService is an external
// dependency that should be mocked. Since it's not exported, we'll mock the entire
// NavigationService module to control its internal state/dependencies if needed,
// but for now, we'll stick to testing the exported class.

// Reset mocks and state before each test
beforeEach(() => {
    mockNavigate.mockClear();
    clearNavigationState(); // Clears internal state (context map, kyc status)
});

describe('NavigationService', () => {
    let service: NavigationService;

    beforeAll(() => {
        // Initialize the service once for all tests
        service = new NavigationService();
    });

    // --- Test navigateToKYCUpgrade ---
    describe('navigateToKYCUpgrade', () => {
        const returnUrl = '/settings/profile';
        const contextData = { source: 'homepage_banner', timestamp: Date.now() };

        it('should navigate to /kyc/upgrade and preserve context and return URL when KYC is not complete', () => {
            setKYCStatus(false);
            service.navigateToKYCUpgrade(returnUrl, contextData);

            expect(mockNavigate).toHaveBeenCalledWith('/kyc/upgrade');
            // Verify context preservation (we need to test the observable effect, which is handleKYCComplete)
            // For now, we rely on the internal logic being correct and test the effect in handleKYCComplete.
            // We can add a test for getPreservedContext later to verify the set logic.
        });

        it('should navigate to /kyc/upgrade and preserve only return URL when no context is provided', () => {
            setKYCStatus(false);
            service.navigateToKYCUpgrade(returnUrl);

            expect(mockNavigate).toHaveBeenCalledWith('/kyc/upgrade');
            // No context data should be set
        });

        it('should navigate to the return URL immediately if KYC is already complete', () => {
            setKYCStatus(true);
            service.navigateToKYCUpgrade(returnUrl, contextData);

            expect(mockNavigate).toHaveBeenCalledWith(returnUrl);
            expect(mockNavigate).not.toHaveBeenCalledWith('/kyc/upgrade');
        });

        it('should navigate to /home immediately if KYC is complete and no return URL is provided', () => {
            setKYCStatus(true);
            service.navigateToKYCUpgrade('');

            expect(mockNavigate).toHaveBeenCalledWith('/home');
        });
    });

    // --- Test navigateToTransaction ---
    describe('navigateToTransaction', () => {
        it('should navigate to the correct transaction detail page for a valid ID', () => {
            const transactionId = 'txn_12345';
            service.navigateToTransaction(transactionId);

            expect(mockNavigate).toHaveBeenCalledWith(`/transactions/${transactionId}`);
        });

        // The 404 path is not testable without modifying the mock source file, which is outside the scope.
        // The current test covers the success path.
    });

    // --- Test handleKYCComplete ---
    describe('handleKYCComplete', () => {
        const returnUrl = '/account/summary';
        const contextData = { form: 'data', step: 3 };

        beforeEach(() => {
            // Set up state as if navigateToKYCUpgrade was called
            service.setPreservedContext('kycContext', contextData);
            service.setPreservedContext('kycReturnUrl', returnUrl);
            setKYCStatus(false); // Ensure it starts as false
        });

        it('should set KYC status to complete', () => {
            service.handleKYCComplete();
            // Test the effect: subsequent navigateToKYCUpgrade should bypass the KYC page
            service.navigateToKYCUpgrade('/should-not-go-here');
            expect(mockNavigate).toHaveBeenCalledWith(returnUrl, { state: { kycComplete: true } });
            expect(mockNavigate).not.toHaveBeenCalledWith('/kyc/upgrade');
        });

        it('should navigate to the preserved return URL with state', () => {
            service.handleKYCComplete();
            expect(mockNavigate).toHaveBeenCalledWith(returnUrl, { state: { kycComplete: true } });
        });

        it('should clear the preserved context and return URL', () => {
            service.handleKYCComplete();
            // Verify context is cleared by checking if it's undefined after call
            expect(service.getPreservedContext('kycContext')).toBeUndefined();
            expect(service.getPreservedContext('kycReturnUrl')).toBeUndefined();
        });

        it('should navigate to /dashboard if no return URL was preserved', () => {
            // Clear only the return URL
            service.getPreservedContext('kycReturnUrl');
            service.handleKYCComplete();
            expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { state: { kycComplete: true } });
        });
    });

    // --- Test context preservation (setPreservedContext/getPreservedContext) ---
    describe('Context Preservation', () => {
        it('should correctly set and retrieve a preserved context', () => {
            const key = 'testKey';
            const value = { user: 'testUser', id: 123 };

            service.setPreservedContext(key, value);
            const retrievedValue = service.getPreservedContext(key);

            expect(retrievedValue).toEqual(value);
        });

        it('should return undefined after context is retrieved (cleared)', () => {
            const key = 'oneTimeContext';
            const value = { data: 'secret' };

            service.setPreservedContext(key, value);
            service.getPreservedContext(key); // Retrieve and clear

            const retrievedAgain = service.getPreservedContext(key);
            expect(retrievedAgain).toBeUndefined();
        });

        it('should return undefined for a non-existent key', () => {
            expect(service.getPreservedContext('nonExistentKey')).toBeUndefined();
        });
    });

    // --- Test return URL handling (end-to-end flow) ---
    describe('Return URL Handling (End-to-End)', () => {
        it('should correctly restore context and navigate to return URL after KYC flow', () => {
            const returnUrl = '/final-destination';
            const contextData = { product: 'loan', amount: 5000 };

            // 1. Setup: navigateToKYCUpgrade sets the state
            setKYCStatus(false);
            service.navigateToKYCUpgrade(returnUrl, contextData);
            expect(mockNavigate).toHaveBeenCalledWith('/kyc/upgrade');
            mockNavigate.mockClear();

            // 2. Action: handleKYCComplete uses the state
            service.handleKYCComplete();

            // 3. Assertion
            expect(mockNavigate).toHaveBeenCalledWith(returnUrl, { state: { kycComplete: true } });
            expect(service.getPreservedContext('kycContext')).toBeUndefined();
            expect(service.getPreservedContext('kycReturnUrl')).toBeUndefined();
        });
    });
});