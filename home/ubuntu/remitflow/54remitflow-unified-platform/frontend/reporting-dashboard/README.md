# Remittance Platform - Reporting Dashboard

This is a complete, production-ready React application for the Remittance Platform's reporting dashboard. It is built with modern web development best practices in mind, focusing on performance, responsiveness, and a professional user experience.

## Features

-   **Modern React with Vite**: Fast development and optimized builds.
-   **Tailwind CSS**: Utility-first CSS framework for rapid UI development.
-   **shadcn/ui components**: Beautiful and accessible UI components.
-   **Lucide Icons**: A comprehensive set of open-source icons.
-   **Recharts**: Powerful and flexible charting library for data visualization.
-   **Multiple Pages/Routes**: Organized application structure with `react-router-dom`.
-   **Responsive Design**: Mobile-first approach ensuring optimal experience across devices.
-   **Professional UI/UX**: Clean, intuitive, and visually appealing interface.
-   **State Management**: Basic state management implemented, extensible for complex needs.
-   **API Integration Ready**: Includes a custom hook (`useApi`) for easy integration with backend services, handling loading and error states.
-   **Error Handling**: Basic error handling for API calls.
-   **Loading States**: Visual feedback during data fetching.

## Project Structure

```
reporting-dashboard/
├── public/
├── src/
│   ├── assets/  # Static assets like images
│   ├── components/
│   │   ├── ui/  # shadcn/ui components
│   │   └── Layout.jsx # Main layout component with sidebar and header
│   ├── hooks/  # Custom React hooks (e.g., useApi.js)
│   ├── lib/  # Utility functions and libraries
│   ├── pages/ # Application pages (Dashboard, Transactions, Agents, Settings)
│   │   ├── Dashboard.jsx
│   │   ├── Transactions.jsx
│   │   ├── Agents.jsx
│   │   └── Settings.jsx
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

## Installation and Setup

1.  **Clone the repository (if applicable):**

    ```bash
    git clone <repository-url>
    cd reporting-dashboard
    ```

2.  **Install dependencies:**

    ```bash
    pnpm install
    ```

3.  **Start the development server:**

    ```bash
    pnpm run dev
    ```

    The application will be accessible at `http://localhost:5173` (or another port if 5173 is in use).

## Usage

Navigate through the sidebar to access different sections of the dashboard:

-   **Dashboard**: Overview of key metrics and charts.
-   **Transactions**: List of recent transactions.
-   **Agents**: List of registered agents.
-   **Settings**: Application settings.

## API Integration

The `src/hooks/useApi.js` custom hook provides a basic structure for fetching data from an API. You can use it in your components like this:

```jsx
import useApi from "@/hooks/useApi";

function MyComponent() {
  const { data, loading, error } = useApi("/api/data");

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error: {error.message}</p>;

  return (
    <div>
      {/* Render your data here */}
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
```

Replace `/api/data` with your actual backend API endpoints.

## Technologies Used

-   React.js
-   Vite
-   Tailwind CSS
-   shadcn/ui
-   Lucide Icons
-   Recharts
-   React Router DOM

## Contributing

Feel free to fork the repository, make changes, and submit pull requests. Please ensure your code adheres to the project's coding standards and includes appropriate tests.

## License

This project is open-source and available under the [MIT License](LICENSE).
