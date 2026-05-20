# offline-pwa - Remittance Platform Frontend

This is a complete, production-ready React application serving as the frontend for an Remittance Platform. It is built with modern web development best practices, focusing on a clean UI/UX, responsiveness, and easy integration with backend services.

## Features

-   **Dashboard**: Overview of key metrics (revenue, subscriptions, sales, active users) with Recharts for data visualization.
-   **Transactions Management**: View and manage recent transactions with status indicators.
-   **Agents Management**: Overview of agents, their status, and activity.
-   **Customers Management**: List of customers with basic details and avatars.
-   **Reports**: Visual reports on sales performance and transaction types using Recharts.
-   **Settings**: User settings including dark mode toggle and profile updates.
-   **Responsive Design**: Mobile-first approach ensuring optimal experience across various devices.
-   **Professional UI/UX**: Utilizes shadcn/ui components and Tailwind CSS for a modern and intuitive interface.
-   **Theme Toggle**: Dark/Light mode switching.
-   **Routing**: Proper application routing using `react-router-dom`.
-   **State Management**: Basic authentication context for managing user login state.
-   **API Integration Ready**: Placeholder for easy integration with backend APIs.

## Technologies Used

-   **React**: A JavaScript library for building user interfaces.
-   **Vite**: A fast frontend build tool.
-   **Tailwind CSS**: A utility-first CSS framework for rapid UI development.
-   **shadcn/ui**: Reusable components built with Radix UI and Tailwind CSS.
-   **Lucide Icons**: A collection of beautiful and customizable open-source icons.
-   **Recharts**: A composable charting library built on React components.
-   **React Router DOM**: Declarative routing for React.

## Installation and Setup

Follow these steps to get the project up and running on your local machine.

### Prerequisites

-   Node.js (v18 or higher)
-   pnpm (or npm/yarn)

### Steps

1.  **Clone the repository**:
    ```bash
    git clone <repository-url>
    cd offline-pwa
    ```

2.  **Install dependencies**:
    ```bash
    pnpm install
    ```

3.  **Run the development server**:
    ```bash
    pnpm run dev
    ```

    The application will be available at `http://localhost:5173` (or another port if 5173 is in use).

## Project Structure

```
offline-pwa/
├── public/
├── src/
│   ├── assets/             # Static assets like images
│   ├── components/
│   │   ├── layout/         # Layout components (e.g., Layout.jsx)
│   │   ├── ui/             # UI components from shadcn/ui
│   │   ├── mode-toggle.jsx # Theme toggle component
│   │   └── theme-provider.jsx # Theme context provider
│   ├── context/            # React Context for state management (e.g., AuthContext.jsx)
│   ├── lib/                # Utility functions and API integration (e.g., api.js, utils.js)
│   ├── routes/             # Page components for different routes
│   │   ├── DashboardPage.jsx
│   │   ├── TransactionsPage.jsx
│   │   ├── AgentsPage.jsx
│   │   ├── CustomersPage.jsx
│   │   ├── ReportsPage.jsx
│   │   └── SettingsPage.jsx
│   ├── App.css             # Global styles and Tailwind CSS directives
│   ├── App.jsx             # Main application component
│   ├── index.css           # Base CSS
│   ├── main.jsx            # Entry point for React application
│   └── router.jsx          # React Router configuration
├── components.json         # shadcn/ui configuration
├── eslint.config.js        # ESLint configuration
├── index.html              # HTML entry point
├── package.json            # Project dependencies and scripts
├── pnpm-lock.yaml          # Lock file for dependencies
└── vite.config.js          # Vite bundler configuration
```

## API Integration

The `src/lib/api.js` file contains placeholder functions for API calls. You will need to update `API_BASE_URL` and implement the actual API logic to connect with your backend services.

## Contributing

Feel free to fork the repository and contribute to its development. Please ensure your code adheres to the project's coding standards and best practices.

## License

This project is open-source and available under the MIT License.

