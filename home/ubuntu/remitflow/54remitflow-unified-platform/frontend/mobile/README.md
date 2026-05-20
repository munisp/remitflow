# Remittance Platform PWA

This is a complete, production-ready React Progressive Web Application (PWA) for an Remittance Platform. It is built with modern web development best practices in mind, featuring a responsive design, professional UI/UX, and a robust technology stack.

## Features

-   **Modern React with Vite**: Fast development and optimized builds.
-   **Tailwind CSS**: Utility-first CSS framework for rapid UI development.
-   **shadcn/ui components**: Beautifully designed and accessible UI components.
-   **Lucide icons**: A comprehensive set of open-source icons.
-   **Recharts**: Powerful charting library for data visualization.
-   **Multiple Pages/Routes**: Home, Dashboard, Transactions, and Settings pages with `react-router-dom`.
-   **Responsive Design**: Mobile-first approach ensuring optimal experience across devices.
-   **Professional UI/UX**: Clean, intuitive, and visually appealing interface.
-   **State Management**: Basic authentication state management using React Context.
-   **API Integration Ready**: Designed for easy integration with backend services.
-   **Authentication**: Login page and protected routes.
-   **Error Handling & Loading States**: Implemented in login process.

## Pages Implemented

1.  **Login Page**: Secure entry point for agents.
2.  **Home Page**: Overview and quick actions for daily tasks.
3.  **Dashboard Page**: Detailed insights into banking operations with charts and key metrics.
4.  **Transactions Page**: Comprehensive history of all transactions with search functionality.
5.  **Settings Page**: Agent profile management, security settings, and app preferences.

## Technology Stack

-   **Frontend**: React.js
-   **Build Tool**: Vite
-   **Styling**: Tailwind CSS
-   **UI Components**: shadcn/ui
-   **Icons**: Lucide React
-   **Charting**: Recharts
-   **Routing**: React Router DOM
-   **State Management**: React Context API

## Getting Started

### Prerequisites

-   Node.js (v18 or higher)
-   pnpm (or npm/yarn)

### Installation

1.  Clone the repository:
    ```bash
    git clone <repository-url>
    cd mobile-pwa
    ```
2.  Install dependencies:
    ```bash
    pnpm install
    ```

### Running the Development Server

```bash
pnpm run dev
```

Open your browser and navigate to `http://localhost:5173` (or the port shown in your terminal).

### Building for Production

```bash
pnpm run build
```

This will generate a `dist` folder with the production-ready build.

## Project Structure

```
mobile-pwa/
├── public/
├── src/
│   ├── assets/             # Static assets like images
│   ├── components/
│   │   └── ui/           # shadcn/ui components
│   ├── context/            # React Context for state management
│   │   └── AuthContext.js
│   ├── pages/              # Application pages
│   │   └── LoginPage.jsx
│   ├── App.css             # Global styles and Tailwind directives
│   ├── App.jsx             # Main application component and routing
│   ├── index.css           # Entry point for global CSS
│   └── main.jsx            # React entry point
├── components.json         # shadcn/ui configuration
├── eslint.config.js        # ESLint configuration
├── index.html              # HTML entry point
├── package.json            # Project dependencies and scripts
├── pnpm-lock.yaml          # Lock file for dependencies
└── vite.config.js          # Vite bundler configuration
```

## API Integration

The application is structured to be easily integrated with backend APIs. Placeholder data is used where actual API calls would be made. You can replace these with `fetch` or `axios` calls to your backend services.

## Contributing

Feel free to fork the repository and submit pull requests. For major changes, please open an issue first to discuss what you would like to change.

