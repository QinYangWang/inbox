// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { WarningIcon } from "@phosphor-icons/react";
import { MutationCache, QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
	isRouteErrorResponse,
	Links,
	Meta,
	Navigate,
	Outlet,
	Scripts,
	ScrollRestoration,
	useLocation,
} from "react-router";
import { Button } from "~/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "~/components/ui/empty";
import { Spinner } from "~/components/ui/spinner";
import { ToastProvider } from "~/components/ui/toast";
import { TooltipProvider } from "~/components/ui/tooltip";
import api, { ApiError } from "~/services/api";
import "./index.css";

function makeQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				refetchOnWindowFocus: false,
				retry: (failureCount, error) => {
					// Don't retry 4xx errors (not found, unauthorized, etc.)
					if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
						return false;
					}
					return failureCount < 2;
				},
			},
		},
		mutationCache: new MutationCache({
			onError: (error) => {
				// Global fallback for mutations that don't handle errors themselves.
				// Consumers using mutateAsync + try/catch handle their own errors.
				console.error("Mutation failed:", error);
			},
		}),
	});
}

// Lazy singleton for the browser — avoids module-scope instantiation that
// leaks cache across SSR requests.
let browserQueryClient: QueryClient | undefined;
function getQueryClient() {
	if (typeof window === "undefined") {
		// SSR: always create a fresh client per request to prevent cross-user cache leaks
		return makeQueryClient();
	}
	// Browser: reuse the same client across navigations
	if (!browserQueryClient) browserQueryClient = makeQueryClient();
	return browserQueryClient;
}

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="UTF-8" />
				<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
				<link
					rel="icon"
					type="image/x-icon"
					href="/favicon.ico"
					sizes="48x48 32x32 16x16"
				/>
				<meta name="viewport" content="width=device-width, initial-scale=1.0" />
				<title>Agentic Inbox</title>
				<Meta />
				<Links />
			</head>
			<body className="relative isolate bg-muted text-foreground antialiased">
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export function HydrateFallback() {
	return (
		<div className="flex items-center justify-center h-screen">
			<Spinner className="size-6" />
		</div>
	);
}

function EncryptionHealthGate() {
	const location = useLocation();
	const { data, isError, isPending } = useQuery({
		queryKey: ["encryption-health"],
		queryFn: api.getEncryptionHealth,
		staleTime: Infinity,
		retry: false,
	});

	// The setup route owns its loading, failure, and success states so it must
	// remain reachable even while encryption is unavailable.
	if (location.pathname === "/encryption-setup") return <Outlet />;
	if (isPending) return <HydrateFallback />;
	if (isError || !data?.healthy) {
		return <Navigate to="/encryption-setup" replace state={{ from: `${location.pathname}${location.search}` }} />;
	}
	return <Outlet />;
}

export default function App() {
	// Use useState to ensure each SSR request gets a fresh client while the
	// browser reuses the same singleton across navigations.
	const [queryClient] = useState(getQueryClient);
	return (
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<ToastProvider>
					<EncryptionHealthGate />
				</ToastProvider>
			</TooltipProvider>
		</QueryClientProvider>
	);
}

export function ErrorBoundary({ error }: { error: unknown }) {
	let title = "Something went wrong";
	let description = "An unexpected error occurred. Please try again.";
	let status: number | null = null;

	if (isRouteErrorResponse(error)) {
		status = error.status;
		if (error.status === 404) {
			title = "Page not found";
			description =
				"The page you're looking for doesn't exist or has been moved.";
		} else {
			title = `Error ${error.status}`;
			description = error.statusText || description;
		}
	} else if (error instanceof Error && import.meta.env.DEV) {
		description = error.message;
	}

	return (
		<div className="flex items-center justify-center min-h-screen p-8">
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<WarningIcon aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>{status === 404 ? "404 — Page not found" : title}</EmptyTitle>
					<EmptyDescription>{description}</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button
						onClick={() => {
							window.location.href = "/";
						}}
					>
						Go Home
					</Button>
				</EmptyContent>
			</Empty>
		</div>
	);
}
