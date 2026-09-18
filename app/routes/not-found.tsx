// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { WarningIcon } from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import { Button } from "~/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "~/components/ui/empty";

export default function NotFoundRoute() {
	const navigate = useNavigate();

	return (
		<div className="flex items-center justify-center min-h-screen">
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<WarningIcon aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>404 -- Page Not Found</EmptyTitle>
					<EmptyDescription>The page you're looking for doesn't exist.</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button size="sm" onClick={() => navigate("/")}>
						Go Home
					</Button>
				</EmptyContent>
			</Empty>
		</div>
	);
}
