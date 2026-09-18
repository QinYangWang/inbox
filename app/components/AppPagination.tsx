// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "~/components/ui/pagination";

interface AppPaginationProps {
	page: number;
	pageCount: number;
	onPageChange: (page: number) => void;
}

function getPageItems(page: number, pageCount: number): (number | "ellipsis")[] {
	if (pageCount <= 7) {
		return Array.from({ length: pageCount }, (_, i) => i + 1);
	}

	const items: (number | "ellipsis")[] = [1];
	const start = Math.max(2, page - 1);
	const end = Math.min(pageCount - 1, page + 1);

	if (start > 2) items.push("ellipsis");
	for (let i = start; i <= end; i++) items.push(i);
	if (end < pageCount - 1) items.push("ellipsis");
	items.push(pageCount);
	return items;
}

export default function AppPagination({
	page,
	pageCount,
	onPageChange,
}: AppPaginationProps) {
	if (pageCount <= 1) return null;

	const items = getPageItems(page, pageCount);

	const go = (next: number) => (event: React.MouseEvent) => {
		event.preventDefault();
		if (next >= 1 && next <= pageCount && next !== page) {
			onPageChange(next);
		}
	};

	return (
		<Pagination>
			<PaginationContent>
				<PaginationItem>
					<PaginationPrevious
						href="#"
						aria-disabled={page <= 1}
						className={page <= 1 ? "pointer-events-none opacity-50" : undefined}
						onClick={go(page - 1)}
					/>
				</PaginationItem>
				{items.map((item, index) =>
					item === "ellipsis" ? (
						<PaginationItem key={`ellipsis-${index}`}>
							<PaginationEllipsis />
						</PaginationItem>
					) : (
						<PaginationItem key={item}>
							<PaginationLink
								href="#"
								isActive={item === page}
								onClick={go(item)}
							>
								{item}
							</PaginationLink>
						</PaginationItem>
					),
				)}
				<PaginationItem>
					<PaginationNext
						href="#"
						aria-disabled={page >= pageCount}
						className={page >= pageCount ? "pointer-events-none opacity-50" : undefined}
						onClick={go(page + 1)}
					/>
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	);
}
