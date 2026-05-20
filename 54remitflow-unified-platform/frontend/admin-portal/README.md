# Remittance Platform Admin Portal

## Description
This project implements a complete, production-ready React frontend application for an Remittance Platform Admin Portal. It provides a modern, responsive, and functional interface for managing agents, customers, transactions, and viewing dashboard analytics.

## Features
- **Dashboard**: Overview of key metrics including total revenue, active agents, transactions, and active customers. Includes a monthly revenue and transactions chart and a list of recent transactions.
- **Agents Management**: View and manage a list of banking agents.
- **Customers Management**: View and manage a list of customers.
- **Transactions Overview**: View and manage all transactions.
- **Settings**: Placeholder for application settings.
- **Responsive Design**: Mobile-first design ensuring usability across various devices.
- **Professional UI/UX**: Built with modern design principles using shadcn/ui components and Tailwind CSS.
- **State Management**: Basic state management implemented using React hooks for data fetching and display.
- **API Integration Ready**: Includes a simulated API (`src/lib/api.js`) to demonstrate data fetching and prepare for actual backend integration.

## Technologies Used
- **React**: A JavaScript library for building user interfaces.
- **Vite**: A fast build tool for modern web projects.
- **Tailwind CSS**: A utility-first CSS framework for rapid UI development.
- **shadcn/ui**: A collection of re-usable components built using Radix UI and Tailwind CSS.
- **Lucide Icons**: A collection of beautiful and customizable open-source icons.
- **Recharts**: A composable charting library built on React components for data visualization.
- **React Router DOM**: Declarative routing for React.

## Installation
To set up and run the project locally, follow these steps:

1.  **Clone the repository (if applicable)**:
    ```bash
    git clone <repository-url>
    cd admin-portal-frontend
    ```

2.  **Install dependencies**: This project uses `pnpm` as its package manager.
    ```bash
    pnpm install
    ```

3.  **Start the development server**:
    ```bash
    pnpm run dev
    ```
    The application will be available at `http://localhost:5173` (or another port if 5173 is in use).

## Usage
- Navigate through the different sections using the sidebar menu (Dashboard, Agents, Customers, Transactions, Settings).
- The Dashboard provides an overview of key business metrics and recent activities.
- The Agents, Customers, and Transactions pages display tabular data, simulating data fetched from a backend.

## Project Structure
```
admin-portal-frontend/
├── public/
├── src/
│   ├── assets/             # Static assets like images
│   ├── components/
│   │   ├── ui/             # UI components from shadcn/ui
│   │   └── Layout.jsx      # Main layout component with sidebar and header
│   ├── hooks/              # Custom React hooks (if any)
│   ├── lib/                # Utility functions and libraries
│   │   └── api.js          # Simulated API for data fetching
│   ├── pages/              # Individual page components
│   │   ├── Agents.jsx
│   │   ├── Customers.jsx
│   │   ├── Dashboard.jsx
│   │   ├── Settings.jsx
│   │   └── Transactions.jsx
│   ├── App.css             # App-specific styles and Tailwind directives
│   ├── App.jsx             # Main application component with routing
│   ├── index.css           # Global styles
│   └── main.jsx            # Entry point of the React application
├── components.json         # shadcn/ui configuration
├── eslint.config.js        # ESLint configuration
├── index.html              # HTML entry point (title updated)
├── package.json            # Project dependencies and scripts
├── pnpm-lock.yaml          # Lock file for dependencies
└── vite.config.js          # Vite bundler configuration
```

## API Integration
The application is designed to be API integration ready. The `src/lib/api.js` file contains a `fetchData` function that simulates API calls. In a real-world scenario, this function would be replaced with actual API calls to a backend service using libraries like `axios` or the native `fetch` API. Loading and error states are implemented in the page components to handle asynchronous data fetching gracefully.

