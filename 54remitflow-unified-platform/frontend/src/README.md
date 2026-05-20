# Remittance Platform - Shared Components Frontend Application

This project implements a production-ready React frontend application for the Remittance Platform's shared components. It is built with modern web development best practices, focusing on a professional UI/UX, responsive design, and API integration readiness.

## Features

-   **Modern React with Vite**: Fast development experience with Vite.
-   **Tailwind CSS**: Utility-first CSS framework for rapid styling.
-   **shadcn/ui components**: Beautifully designed, accessible, and customizable UI components.
-   **Lucide icons**: A collection of open-source icons for a clean visual appeal.
-   **Recharts**: Composable charting library for data visualization on the dashboard.
-   **Multiple Pages/Routes**: Implemented using `react-router-dom` for seamless navigation.
    -   `/`: Home Page with overview statistics.
    -   `/dashboard`: Dashboard with data visualizations.
    -   `/settings`: User settings page.
-   **Responsive Design**: Mobile-first approach ensuring optimal experience across devices.
-   **State Management**: Basic state management demonstrated with `useState` and custom hooks.
-   **API Integration Ready**: Includes a `useApi` custom hook for simplified data fetching and handling loading/error states.
-   **Professional UI/UX**: Clean, modern, and intuitive user interface.

## Technologies Used

-   React 18
-   Vite
-   Tailwind CSS
-   shadcn/ui
-   Lucide React
-   Recharts
-   React Router DOM

## Project Structure

```
shared-components-app/
├── public/
├── src/
│   ├── assets/  # Static assets like images
│   ├── components/
│   │   ├── layout/ # Layout components (Header, Footer, MainLayout)
│   │   └── ui/  # UI components from shadcn/ui
│   ├── hooks/  # Custom React hooks (e.g., useApi)
│   ├── lib/  # Utility functions and libraries
│   ├── pages/  # Application pages (HomePage, DashboardPage, SettingsPage)
│   ├── App.css  # App-specific styles
│   ├── App.jsx  # Main App component with routing
│   ├── index.css  # Global styles
│   └── main.jsx  # Entry point
├── components.json  # shadcn/ui configuration
├── eslint.config.js  # ESLint configuration
├── index.html  # HTML entry point
├── package.json  # Project dependencies and scripts
├── pnpm-lock.yaml  # Lock file for dependencies
└── vite.config.js  # Vite bundler configuration
```

## Installation and Running Locally

1.  **Clone the repository (if applicable):**
    ```bash
    git clone <repository-url>
    cd shared-components-app
    ```

2.  **Install dependencies:**
    ```bash
    pnpm install
    ```

3.  **Start the development server:**
    ```bash
    pnpm run dev
    ```

    The application will be available at `http://localhost:5173` (or another port if 5173 is in use).

## API Integration

The application is designed to be easily integrated with backend services. The `src/hooks/useApi.js` provides a basic structure for fetching data, handling loading states, and errors. You can extend this hook or replace it with a more robust data-fetching library (e.g., React Query, SWR) as needed.

## Responsive Design

The application utilizes Tailwind CSS for a mobile-first responsive design. Components and layouts are designed to adapt gracefully to various screen sizes.

## Error Handling and Loading States

Loading and error states are demonstrated in the `HomePage.jsx` using the `useApi` hook, providing a better user experience during data fetching.

## Customization

-   **Theming**: Tailwind CSS and shadcn/ui allow for easy theme customization by modifying `tailwind.config.js` and `src/App.css`.
-   **Components**: New shadcn/ui components can be added using the `shadcn-ui` CLI if needed.

This application serves as a robust foundation for building and integrating shared components within the Remittance Platform.
