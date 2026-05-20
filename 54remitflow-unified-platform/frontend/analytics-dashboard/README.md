# Remittance Platform - Analytics Dashboard Frontend

This project implements a complete, production-ready React frontend application for an Remittance Platform's analytics dashboard. It is built with modern web development best practices, focusing on a professional UI/UX, responsiveness, and API integration readiness.

## Features

-   **Modern React with Vite**: Fast development and optimized builds.
-   **Tailwind CSS**: Utility-first CSS framework for rapid UI development.
-   **shadcn/ui components**: Reusable and accessible UI components.
-   **Lucide icons**: A collection of beautiful and consistent open-source icons.
-   **Recharts**: A composable charting library built on React components for data visualization.
-   **Multiple Pages/Routes**: Dashboard, Transactions, Agents, and Settings pages.
-   **Responsive Design**: Mobile-first approach ensuring optimal experience across devices.
-   **Professional UI/UX**: Clean, intuitive, and aesthetically pleasing user interface.
-   **State Management**: Basic authentication context for user session management.
-   **API Integration Ready**: Designed to easily connect with backend services.
-   **Error Handling & Loading States**: (Planned for future integration with actual API calls)

## Technologies Used

-   React 19
-   Vite
-   Tailwind CSS
-   shadcn/ui
-   Lucide icons
-   Recharts
-   React Router DOM

## Setup Instructions

To get the project up and running locally, follow these steps:

1.  **Clone the repository (if applicable):**

    ```bash
    git clone <repository-url>
    cd analytics-dashboard-frontend
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

Navigate through the dashboard using the sidebar menu. The application provides an overview of key metrics, a list of recent transactions, agent management, and a settings page.

## Project Structure

```
├── public/
├── src/
│   ├── assets/ 
│   ├── components/
│   │   ├── ui/  # shadcn/ui components
│   │   └── Layout.jsx # Main layout component
│   ├── context/
│   │   └── AuthContext.jsx # Authentication context
│   ├── pages/
│   │   ├── Agents.jsx
│   │   ├── Dashboard.jsx
│   │   ├── Settings.jsx
│   │   └── Transactions.jsx
│   ├── App.css
│   ├── App.jsx  # Main application component with routing
│   ├── index.css
│   └── main.jsx # Entry point with AuthProvider
├── components.json
├── eslint.config.js
├── index.html
├── package.json
├── pnpm-lock.yaml
└── vite.config.js
```

