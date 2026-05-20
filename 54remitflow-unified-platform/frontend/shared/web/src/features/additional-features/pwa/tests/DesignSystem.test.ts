import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// Import the system under test
import { colors, spacing, typography, borderRadius, isValidColor, getSpacing, applyToken } from './DesignSystem';
import { Button } from './Button';
import { Input } from './Input';
import { Card } from './Card';

// --- Setup/Teardown (Minimal for this scope, but good practice) ---
beforeEach(() => {
  // Clean up the DOM after each test
  document.body.innerHTML = '';
});

// --- 1. Test Design Tokens and Utility Functions (DesignSystem.ts) ---
describe('DesignSystem Tokens', () => {
  test('should export a comprehensive set of color tokens', () => {
    expect(colors).toBeDefined();
    expect(colors.primary).toBe('#007bff');
    expect(colors.danger).toBe('#dc3545');
    expect(Object.keys(colors).length).toBeGreaterThanOrEqual(10);
  });

  test('should export a comprehensive set of spacing tokens', () => {
    expect(spacing).toBeDefined();
    expect(spacing.md).toBe('16px');
    expect(spacing.xl).toBe('32px');
    expect(Object.keys(spacing).length).toBeGreaterThanOrEqual(5);
  });

  test('should export typography tokens including font family and sizes', () => {
    expect(typography).toBeDefined();
    expect(typography.fontFamily).toBe('Arial, sans-serif');
    expect(typography.fontSize.md).toBe('16px');
    expect(typography.fontWeight.bold).toBe(700);
  });

  test('should export border radius tokens', () => {
    expect(borderRadius).toBeDefined();
    expect(borderRadius.sm).toBe('4px');
    expect(borderRadius.lg).toBe('12px');
  });

  describe('Utility Functions', () => {
    test('isValidColor should return true for valid color keys', () => {
      expect(isValidColor('primary')).toBe(true);
      expect(isValidColor('background')).toBe(true);
    });

    test('isValidColor should return false for invalid color keys (edge case)', () => {
      // @ts-ignore - Testing invalid input
      expect(isValidColor('nonExistentColor')).toBe(false);
    });

    test('getSpacing should return the correct spacing value', () => {
      expect(getSpacing('lg')).toBe('24px');
    });

    test('applyToken should correctly merge a token into a style object', () => {
      const initialStyle = { fontSize: '12px' };
      const newStyle = applyToken(initialStyle, 'color', colors.primary);
      expect(newStyle).toEqual({ fontSize: '12px', color: '#007bff' });
    });

    test('applyToken should overwrite existing properties', () => {
      const initialStyle = { color: 'red' };
      const newStyle = applyToken(initialStyle, 'color', colors.danger);
      expect(newStyle).toEqual({ color: '#dc3545' });
    });
  });
});

// --- 2. Test Button Component ---
describe('Button Component', () => {
  const mockOnClick = jest.fn();

  test('should render with default variant and text', () => {
    render(<Button onClick={mockOnClick}>Click Me</Button>);
    const button = screen.getByRole('button', { name: /click me/i });
    expect(button).toBeInTheDocument();
    // Default variant is 'primary', check for primary color
    expect(button).toHaveStyle(`background-color: ${colors.primary}`);
  });

  test('should handle click events (success scenario)', () => {
    render(<Button onClick={mockOnClick}>Submit</Button>);
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  test('should render with secondary variant', () => {
    render(<Button onClick={mockOnClick} variant="secondary">Cancel</Button>);
    const button = screen.getByRole('button', { name: /cancel/i });
    expect(button).toHaveStyle(`background-color: ${colors.secondary}`);
  });

  test('should render with danger variant', () => {
    render(<Button onClick={mockOnClick} variant="danger">Delete</Button>);
    const button = screen.getByRole('button', { name: /delete/i });
    expect(button).toHaveStyle(`background-color: ${colors.danger}`);
  });

  test('should render in disabled state (error scenario/edge case)', () => {
    render(<Button onClick={mockOnClick} disabled>Disabled Button</Button>);
    const button = screen.getByRole('button', { name: /disabled button/i });
    expect(button).toBeDisabled();
    expect(button).toHaveStyle(`background-color: ${colors.light}`);
    // Should not call onClick when disabled
    fireEvent.click(button);
    expect(mockOnClick).not.toHaveBeenCalled();
  });

  test('should have correct accessibility attributes (aria-label)', () => {
    render(<Button onClick={mockOnClick} aria-label="Close Modal">X</Button>);
    const button = screen.getByRole('button', { name: /close modal/i });
    expect(button).toHaveAttribute('aria-label', 'Close Modal');
    expect(button).toHaveTextContent('X');
  });
});

// --- 3. Test Input Component ---
describe('Input Component', () => {
  const mockOnChange = jest.fn();

  test('should render with a label and be accessible', () => {
    render(<Input label="Username" id="username-input" onChange={mockOnChange} />);
    const input = screen.getByLabelText(/username/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('id', 'username-input');
    expect(screen.getByText('Username')).toHaveAttribute('for', 'username-input');
  });

  test('should handle input changes (success scenario)', () => {
    render(<Input label="Email" onChange={mockOnChange} />);
    const input = screen.getByLabelText(/email/i);
    fireEvent.change(input, { target: { value: 'test@example.com' } });
    expect(mockOnChange).toHaveBeenCalledTimes(1);
    // Check the value is updated (RTL doesn't update the DOM value in a mock, but we test the event handler)
    // For a full test, we would check the value prop if it were a controlled component, but here we check the handler.
  });

  test('should display an error message and have correct aria attributes (error scenario)', () => {
    const errorMessage = 'This field is required.';
    render(<Input label="Password" error={errorMessage} />);
    const input = screen.getByLabelText(/password/i);
    const errorText = screen.getByText(errorMessage);

    expect(errorText).toBeInTheDocument();
    expect(errorText).toHaveAttribute('role', 'alert');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', `${input.id}-error`);
    expect(input).toHaveStyle(`border: 1px solid ${colors.danger}`);
  });

  test('should render without a label but with aria-label for accessibility', () => {
    render(<Input aria-label="Search Field" />);
    const input = screen.getByRole('textbox', { name: /search field/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-label', 'Search Field');
  });

  test('should correctly pass through standard input props (edge case: type)', () => {
    render(<Input type="number" aria-label="Age" />);
    const input = screen.getByRole('spinbutton', { name: /age/i }); // Role for type="number"
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'number');
  });
});

// --- 4. Test Card Component ---
describe('Card Component', () => {
  test('should render children content', () => {
    render(<Card><div>Card Content</div></Card>);
    expect(screen.getByText('Card Content')).toBeInTheDocument();
  });

  test('should render with a title', () => {
    const cardTitle = 'User Profile';
    render(<Card title={cardTitle}>Content</Card>);
    const titleElement = screen.getByRole('heading', { name: cardTitle, level: 2 });
    expect(titleElement).toBeInTheDocument();
  });

  test('should have a region role for accessibility', () => {
    render(<Card title="Settings">Content</Card>);
    const card = screen.getByRole('region', { name: 'Settings' });
    expect(card).toBeInTheDocument();
  });

  test('should use aria-label when title is missing', () => {
    render(<Card aria-label="Anonymous Card">Content</Card>);
    const card = screen.getByRole('region', { name: 'Anonymous Card' });
    expect(card).toBeInTheDocument();
  });

  test('should prioritize title over aria-label for region name', () => {
    render(<Card title="Main Content" aria-label="Ignored Label">Content</Card>);
    const card = screen.getByRole('region', { name: 'Main Content' });
    expect(card).toBeInTheDocument();
    // Check that the name is 'Main Content', not 'Ignored Label'
    expect(() => screen.getByRole('region', { name: 'Ignored Label' })).toThrow();
  });

  test('should apply design token styles (edge case: box-shadow)', () => {
    render(<Card>Content</Card>);
    const card = screen.getByText('Content').closest('div');
    expect(card).toHaveStyle('box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1)');
    expect(card).toHaveStyle(`border-radius: ${borderRadius.md}`);
  });
});

// --- 5. Accessibility Testing (Integrated) ---
// Accessibility is tested throughout by using appropriate roles (button, textbox, region, heading)
// and attributes (aria-label, aria-invalid, aria-describedby, role="alert").
// The tests above cover:
// - Button: role="button", aria-label, disabled state.
// - Input: label/id association, aria-invalid, aria-describedby, role="alert" for error.
// - Card: role="region", title/aria-label for accessible name.