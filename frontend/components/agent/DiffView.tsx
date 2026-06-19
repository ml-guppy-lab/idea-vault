interface DiffViewProps {
	label: string;
	oldValue: string | null | undefined;
	newValue: string | null | undefined;
}

export function DiffView({ label, oldValue, newValue }: DiffViewProps) {
	// If values are identical, there is nothing meaningful to review.
	if (oldValue === newValue) return null;

	return (
		<div className="mb-3">
			<p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				{label}
			</p>

			<div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
				{oldValue ? (
					<div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
						<p className="mb-1 text-xs font-medium text-red-600 dark:text-red-400">Before</p>
						<p className="whitespace-pre-wrap break-words text-red-800 line-through opacity-75 dark:text-red-200">
							{oldValue}
						</p>
					</div>
				) : null}

				{newValue ? (
					<div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
						<p className="mb-1 text-xs font-medium text-green-600 dark:text-green-400">After</p>
						<p className="whitespace-pre-wrap break-words text-green-800 dark:text-green-200">
							{newValue}
						</p>
					</div>
				) : null}
			</div>
		</div>
	);
}
