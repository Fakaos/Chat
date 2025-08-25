# Overview

This is a full-stack web application built with React and Express, featuring a chat interface that integrates with a Llama AI model. The application uses modern web technologies including TypeScript, Tailwind CSS, and shadcn/ui components for the frontend, with Express.js handling the backend API routes. The project is configured with Drizzle ORM for database operations and includes comprehensive UI components for building interactive interfaces.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
- **Framework**: React 18 with TypeScript and Vite for fast development and building
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack Query (React Query) for server state management and API data fetching
- **UI Framework**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom CSS variables for theming support
- **Form Handling**: React Hook Form with Zod resolvers for validation

## Backend Architecture
- **Runtime**: Node.js with Express.js framework
- **Language**: TypeScript with ES modules
- **Database**: PostgreSQL with Drizzle ORM for type-safe database operations
- **Database Provider**: Neon Database (serverless PostgreSQL)
- **Storage Pattern**: Repository pattern with both in-memory and database storage implementations
- **Session Management**: PostgreSQL-backed sessions using connect-pg-simple

## Development Environment
- **Build System**: Vite for frontend bundling and development server
- **Backend Build**: esbuild for server-side bundling
- **Development**: Concurrent development with Vite middleware integration
- **Hot Reload**: Full-stack hot reloading in development mode
- **Replit Integration**: Custom plugins for Replit environment support

## Database Design
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: Centralized in `/shared/schema.ts` for type sharing
- **Migrations**: Drizzle Kit for database schema migrations
- **User Schema**: Basic user table with ID, username, and password fields
- **Type Safety**: Automatic TypeScript type generation from database schema

## API Integration
- **External AI Service**: Llama AI model integration via ngrok tunnel
- **HTTP Client**: Fetch API with custom error handling and response parsing
- **API Pattern**: RESTful endpoints with `/api` prefix
- **Error Handling**: Centralized error handling with proper HTTP status codes

# External Dependencies

## Core Frameworks
- **React**: Frontend UI library with hooks and modern patterns
- **Express.js**: Backend web framework for Node.js
- **Vite**: Build tool and development server
- **TypeScript**: Static type checking across the entire stack

## Database & ORM
- **Drizzle ORM**: Type-safe database toolkit with PostgreSQL support
- **Neon Database**: Serverless PostgreSQL database provider
- **connect-pg-simple**: PostgreSQL session store for Express sessions

## UI & Styling
- **Tailwind CSS**: Utility-first CSS framework
- **Radix UI**: Unstyled, accessible UI components
- **shadcn/ui**: Pre-built component library based on Radix UI
- **Lucide React**: Icon library for React applications

## State Management & Data Fetching
- **TanStack Query**: Server state management and caching
- **React Hook Form**: Form state management and validation
- **Zod**: Schema validation library

## External Services
- **Llama AI Model**: External AI service accessed via ngrok tunnel at `https://0c8125184293.ngrok-free.app/api/generate`
- **Font Services**: Google Fonts for typography (Inter, DM Sans, Fira Code, Geist Mono)

## Development Tools
- **Replit Plugins**: Custom Vite plugins for Replit environment integration
- **PostCSS**: CSS processing with Tailwind and Autoprefixer
- **ESBuild**: Fast JavaScript/TypeScript bundler for production builds