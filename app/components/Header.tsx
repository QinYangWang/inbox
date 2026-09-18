// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { GearSixIcon, ListIcon, MagnifyingGlassIcon, RobotIcon, XIcon } from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useUIStore } from "~/hooks/useUIStore";

export default function Header() {
	const [searchQuery, setSearchQuery] = useState("");
	const [isSearchExpanded, setIsSearchExpanded] = useState(false);
	const { mailboxId } = useParams<{ mailboxId: string }>();
	const navigate = useNavigate();
	const location = useLocation();
	const [searchParams] = useSearchParams();
	const { toggleSidebar, toggleAgentPanel, isAgentPanelOpen } = useUIStore();

	// Sync search input with URL query param so it stays populated
	const urlQuery = searchParams.get("q") || "";
	useEffect(() => {
		if (location.pathname.includes("/search") && urlQuery) {
			setSearchQuery(urlQuery);
		}
	}, [urlQuery, location.pathname]);

	const performSearch = () => {
		if (mailboxId && searchQuery.trim()) {
			const q = searchQuery.trim();
			navigate(`/mailbox/${mailboxId}/search?q=${encodeURIComponent(q)}`);
			setIsSearchExpanded(false);
		}
	};

	const clearSearch = () => {
		setSearchQuery("");
		if (location.pathname.includes("/search") && mailboxId) {
			navigate(`/mailbox/${mailboxId}/emails/inbox`);
		}
	};

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter") {
			performSearch();
		}
		if (e.key === "Escape") {
			if (searchQuery) {
				clearSearch();
			} else {
				setIsSearchExpanded(false);
			}
		}
	};

	const isSettingsActive = location.pathname.includes("/settings");

	return (
		<header className="flex items-center gap-2 px-3 py-2.5 bg-card border-b border-border sticky top-0 z-10 md:px-5 md:gap-4">
			{/* Hamburger menu - mobile only */}
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={toggleSidebar}
				aria-label="Toggle sidebar"
				className="md:hidden shrink-0"
			>
				<ListIcon size={20} aria-hidden="true" />
			</Button>

			{/* Search - full on desktop, collapsible on mobile */}
			<div
				className={`flex-1 max-w-lg transition-all flex items-center gap-1 ${
					isSearchExpanded ? "flex" : "hidden md:flex"
				}`}
			>
				<div className="flex-1 relative flex items-center">
					<Input
						className="w-full"
						aria-label="Search emails"
						placeholder="Search emails... (try from:name, is:unread, has:attachment)"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						onKeyDown={handleKeyDown}
					/>
					{searchQuery && (
						<button
							type="button"
							onClick={clearSearch}
							className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
							aria-label="Clear search"
						>
							<XIcon size={14} aria-hidden="true" />
						</button>
					)}
				</div>
				<Tooltip>
					<TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="Search" onClick={performSearch} />}>
						<MagnifyingGlassIcon size={20} aria-hidden="true" />
					</TooltipTrigger>
					<TooltipPopup side="bottom">Search</TooltipPopup>
				</Tooltip>
			</div>

			{/* Search toggle button - mobile only, hidden when search is expanded */}
			{!isSearchExpanded && (
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={() => setIsSearchExpanded(true)}
					aria-label="Search"
					className="md:hidden shrink-0"
				>
					<MagnifyingGlassIcon size={20} aria-hidden="true" />
				</Button>
			)}

			<div className="flex items-center gap-1 ml-auto shrink-0">
				<Tooltip>
					<TooltipTrigger render={<Button variant={isAgentPanelOpen ? "secondary" : "ghost"} size="icon" onClick={toggleAgentPanel} aria-label="Toggle agent panel" className="hidden lg:inline-flex" />}>
						<RobotIcon size={20} aria-hidden="true" />
					</TooltipTrigger>
					<TooltipPopup side="bottom">{isAgentPanelOpen ? "Hide agent panel" : "Show agent panel"}</TooltipPopup>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								variant={isSettingsActive ? "secondary" : "ghost"}
								size="icon"
								aria-label="Settings"
								onClick={() =>
									navigate(
										isSettingsActive
											? `/mailbox/${mailboxId}/emails/inbox`
											: `/mailbox/${mailboxId}/settings`,
									)
								}
							/>
						}
					>
						<GearSixIcon size={20} aria-hidden="true" />
					</TooltipTrigger>
					<TooltipPopup side="bottom">Settings</TooltipPopup>
				</Tooltip>
			</div>
		</header>
	);
}
