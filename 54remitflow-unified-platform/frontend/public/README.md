# Remittance Platform Frontend

This is a complete, production-ready React application for the Remittance Platform public website. It is built with modern web development best practices and incorporates a range of powerful technologies to deliver a responsive, professional, and highly interactive user experience.

## Features

-   **Modern React with Vite**: Developed using the latest React features and bundled with Vite for a fast development experience and optimized production builds.
-   **Tailwind CSS for Styling**: Utilizes Tailwind CSS for utility-first styling, enabling rapid UI development and easy customization.
-   **shadcn/ui Components**: Integrates shadcn/ui components for a beautiful and accessible design system.
-   **Lucide Icons**: Incorporates Lucide icons for a clean and consistent icon set across the application.
-   **Recharts for Data Visualization**: Features interactive data visualizations powered by Recharts, particularly visible on the Dashboard page.
-   **Multiple Pages/Routes**: Implements a multi-page application structure with `react-router-dom` for seamless navigation.
-   **Responsive Design (Mobile-First)**: Designed with a mobile-first approach to ensure optimal viewing and interaction across various devices and screen sizes.
-   **Professional UI/UX**: Focuses on a clean, intuitive, and professional user interface and experience.
-   **State Management**: Includes basic authentication state management using React Context API.
-   **API Integration Ready**: Structured to easily integrate with backend services, with placeholders for future API calls.
-   **Error Handling**: Basic error handling implemented for authentication.
-   **Loading States**: (To be implemented for API calls)

## Project Structure

```
remittance-platform-frontend/
├── public/
├── src/
│   ├── assets/             # Static assets like images
│   ├── components/         # Reusable React components
│   │   ├── ui/             # shadcn/ui components
│   │   ├── Footer.jsx      # Application footer
│   │   ├── Layout.jsx      # Main layout wrapper
│   │   ├── Navbar.jsx      # Navigation bar
│   │   └── PrivateRoute.jsx # Route protection component
│   ├── context/            # React Context for state management
│   │   └── AuthContext.jsx # Authentication context
│   ├── pages/              # Application pages/routes
│   │   ├── About.jsx
│   │   ├── Contact.jsx
│   │   ├── Dashboard.jsx
│   │   ├── Home.jsx
│   │   ├── LoginPage.jsx
│   │   └── Services.jsx
│   ├── App.css             # App-specific styles
│   ├── App.jsx             # Main application component with routing
│   ├── index.css           # Global styles
│   └── main.jsx            # Entry point of the React application
├── components.json         # shadcn/ui configuration
├── eslint.config.js        # ESLint configuration
├── index.html              # HTML entry point
├── package.json            # Project dependencies and scripts
├── pnpm-lock.yaml          # Lock file for dependencies
└── vite.config.js          # Vite bundler configuration
```

## Getting Started

### Prerequisites

Make sure you have Node.js (v18 or higher) and pnpm installed on your machine.

### Installation

1.  **Clone the repository (if applicable):**

    ```bash
    git clone <repository-url>
    cd remittance-platform-frontend
    ```

2.  **Install dependencies:**

    ```bash
    pnpm install
    ```

### Running the Development Server

To start the development server:

```bash
pnpm run dev
```

This will typically start the application on `http://localhost:5173` (or another available port). The development server supports hot module replacement (HMR), so changes will be reflected automatically.

### Building for Production

To create a production-ready build of the application:

```bash
pnpm run build
```

The build artifacts will be placed in the `dist` directory.

### Linting

To run ESLint for code quality checks:

```bash
pnpm run lint
```

## Technologies Used

-   [React](https://react.dev/)
-   [Vite](https://vitejs.dev/)
-   [Tailwind CSS](https://tailwindcss.com/)
-   [shadcn/ui](https://ui.shadcn.com/)
-   [Lucide Icons](https://lucide.dev/)
-   [Recharts](https://recharts.org/en-US/)
-   [React Router DOM](https://reactrouter.com/web/guides/quick-start)

## API Integration

The application is designed to be API integration ready. You can add your API calls within components or create a dedicated `services` directory for API-related logic. Examples of where API calls might be integrated include:

-   Fetching data for the Dashboard.
-   Handling user authentication (login/logout).
-   Submitting contact forms.

## Responsive Design

The application employs a mobile-first responsive design approach. Tailwind CSS utility classes are used to adapt the layout and components for various screen sizes, ensuring a consistent experience across desktops, tablets, and mobile devices.

## State Management

Basic authentication state is managed using React's Context API (`src/context/AuthContext.jsx`). For more complex global state requirements, consider integrating libraries like Zustand or Redux Toolkit.

## Error Handling

Basic error handling is implemented for the login process. For production applications, a more robust error handling strategy should be implemented, including:

-   Global error boundaries.
-   Displaying user-friendly error messages.
-   Logging errors to a monitoring service.

## License

This project is open-source and available under the [MIT License](https://opensource.org/licenses/MIT).
