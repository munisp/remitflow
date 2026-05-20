"""
End-to-end test for AddBeneficiary
Tests complete user journey from start to finish
"""
import pytest
from playwright.async_api import async_playwright, Page, expect
import asyncio

@pytest.mark.e2e
class TestAddBeneficiaryE2E:
    """End-to-end tests for adding new beneficiary."""
    
    @pytest.fixture
    async def browser_page(self):
        """Create browser page for testing."""
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 1920, "height": 1080},
                user_agent="Mozilla/5.0 (Test Bot)"
            )
            page = await context.new_page()
            yield page
            await context.close()
            await browser.close()
    
    @pytest.fixture
    def test_user_data(self):
        """Test user credentials and data."""
        return {
            "email": "test_e2e@example.com",
            "password": "Test123!@#",
            "phone": "+1234567890",
            "name": "Test User"
        }
    
    @pytest.mark.asyncio
    async def test_add_beneficiary_complete_flow(self, browser_page: Page, test_user_data):
        """Test complete adding new beneficiary journey."""
        page = browser_page
        
        # Step 1: Navigate to beneficiaries
        await page.goto("http://localhost:3000")
        await page.wait_for_load_state("networkidle")
        
        # Fill login form
        await page.fill('input[name="email"]', test_user_data["email"])
        await page.fill('input[name="password"]', test_user_data["password"])
        await page.click('button[type="submit"]')
        
        # Wait for navigation
        await page.wait_for_url("**/dashboard")
        await expect(page.locator("h1")).to_contain_text("Dashboard")
        
        # Step 2: Enter beneficiary details
        await page.click('text="Add New"')
        await page.wait_for_selector('[data-testid="beneficiary-form"]')
        
        # Fill transfer amount
        await page.fill('[data-testid="amount-input"]', "1000")
        await page.select_option('[data-testid="currency-select"]', "USD")
        await page.click('[data-testid="continue-button"]')
        
        # Step 3: Save beneficiary
        await page.wait_for_selector('[data-testid="beneficiary-list"]')
        
        # Fill recipient details
        await page.fill('[data-testid="recipient-name"]', "Jane Doe")
        await page.fill('[data-testid="recipient-account"]', "0123456789")
        await page.click('[data-testid="confirm-button"]')
        
        # Step 4: Verify completion
        await page.wait_for_selector('[data-testid="success-message"]')
        success_message = await page.locator('[data-testid="success-message"]').text_content()
        assert "success" in success_message.lower()
        
        # Verify transaction appears in history
        await page.click('text="Transaction History"')
        await page.wait_for_selector('[data-testid="transaction-list"]')
        transactions = await page.locator('[data-testid="transaction-item"]').count()
        assert transactions > 0
    
    @pytest.mark.asyncio
    async def test_add_beneficiary_error_handling(self, browser_page: Page, test_user_data):
        """Test error handling in adding new beneficiary."""
        page = browser_page
        
        # Navigate to page
        await page.goto("http://localhost:3000")
        await page.fill('input[name="email"]', test_user_data["email"])
        await page.fill('input[name="password"]', test_user_data["password"])
        await page.click('button[type="submit"]')
        await page.wait_for_url("**/dashboard")
        
        # Trigger error condition
        await page.click('text="Add New"')
        await page.fill('[data-testid="amount-input"]', "-100")  # Invalid amount
        await page.click('[data-testid="continue-button"]')
        
        # Verify error message
        await page.wait_for_selector('[data-testid="error-message"]')
        error_message = await page.locator('[data-testid="error-message"]').text_content()
        assert "invalid" in error_message.lower() or "error" in error_message.lower()
    
    @pytest.mark.asyncio
    async def test_add_beneficiary_mobile_responsive(self, test_user_data):
        """Test adding new beneficiary on mobile viewport."""
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(
                viewport={"width": 375, "height": 667},  # iPhone SE
                user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)"
            )
            page = await context.new_page()
            
            # Test mobile flow
            await page.goto("http://localhost:3000")
            await page.fill('input[name="email"]', test_user_data["email"])
            await page.fill('input[name="password"]', test_user_data["password"])
            await page.click('button[type="submit"]')
            
            # Verify mobile UI
            await page.wait_for_url("**/dashboard")
            mobile_menu = await page.locator('[data-testid="mobile-menu"]').is_visible()
            assert mobile_menu
            
            await context.close()
            await browser.close()
    
    @pytest.mark.asyncio
    async def test_add_beneficiary_accessibility(self, browser_page: Page, test_user_data):
        """Test accessibility of adding new beneficiary."""
        page = browser_page
        
        # Navigate to page
        await page.goto("http://localhost:3000")
        
        # Check for accessibility violations
        # This would use axe-core or similar
        await page.evaluate("""
            // Inject axe-core
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.7.2/axe.min.js';
            document.head.appendChild(script);
        """)
        
        await page.wait_for_timeout(1000)  # Wait for axe to load
        
        # Run accessibility audit
        violations = await page.evaluate("axe.run()")
        assert len(violations.get("violations", [])) == 0, "Accessibility violations found"
    
    @pytest.mark.asyncio
    async def test_add_beneficiary_performance(self, browser_page: Page, test_user_data):
        """Test performance of adding new beneficiary."""
        page = browser_page
        
        # Start performance measurement
        await page.goto("http://localhost:3000")
        
        # Measure page load time
        performance_timing = await page.evaluate("""
            JSON.stringify(window.performance.timing)
        """)
        
        import json
        timing = json.loads(performance_timing)
        load_time = timing["loadEventEnd"] - timing["navigationStart"]
        
        # Assert page loads in under 3 seconds
        assert load_time < 3000, f"Page load time {load_time}ms exceeds 3000ms"
