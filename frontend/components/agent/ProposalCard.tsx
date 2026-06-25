"use client";

import { useState } from "react";
import { Check, Lightbulb, ListTodo, Sparkles, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { DiffView } from "./DiffView";

type ProposalStatus = "pending" | "accepted" | "rejected";

interface IdeaUpdateProposal {
	proposal_type: "idea_update";
	proposal_id: string;
	status: ProposalStatus;
	idea_id: string;
	current_title: string;
	new_title: string;
	current_description?: string | null;
	new_description?: string | null;
	new_status?: string | null;
	new_priority?: string | null;
	reasoning: string;
}

interface IdeaCreationProposal {
	proposal_type: "idea_creation";
	proposal_id: string;
	status: ProposalStatus;
	title: string;
	description: string;
	proposed_status?: string;
	proposed_priority?: string;
	tags?: string[];
	reasoning: string;
}

interface TaskCreationProposal {
	proposal_type: "task_creation";
	proposal_id: string;
	status: ProposalStatus;
	idea_id: string;
	idea_title: string;
	task_title: string;
	task_description?: string | null;
	reasoning: string;
}

export type Proposal = IdeaUpdateProposal | IdeaCreationProposal | TaskCreationProposal;

interface ProposalCardProps {
	proposal: Proposal;
	onAccept: (proposal: Proposal) => Promise<void>;
	onReject: (proposal: Proposal) => void;
	/**
	 * Final state of a proposal that was already resolved in a previous render
	 * (e.g. restored from sessionStorage). When set, the card renders in its
	 * resolved state and cannot be accepted again — this prevents a reloaded
	 * "pending" card from being accepted twice (which would duplicate ideas/tasks).
	 */
	initialStatus?: "accepted" | "rejected";
	/** Reports the terminal decision up to the parent so it can be persisted. */
	onResolved?: (proposalId: string, status: "accepted" | "rejected") => void;
}

export function ProposalCard({
	proposal,
	onAccept,
	onReject,
	initialStatus,
	onResolved,
}: ProposalCardProps) {
	const [status, setStatus] = useState<"pending" | "accepting" | "accepted" | "rejected">(
		initialStatus ?? "pending"
	);

	const handleAccept = async () => {
		try {
			setStatus("accepting");
			await onAccept(proposal);
			setStatus("accepted");
			onResolved?.(proposal.proposal_id, "accepted");
		} catch {
			// Keep the card actionable if apply fails.
			setStatus("pending");
		}
	};

	const handleReject = () => {
		onReject(proposal);
		setStatus("rejected");
		onResolved?.(proposal.proposal_id, "rejected");
	};

	const getIcon = () => {
		if (proposal.proposal_type === "idea_update") return <Sparkles className="h-4 w-4" />;
		if (proposal.proposal_type === "idea_creation") return <Lightbulb className="h-4 w-4" />;
		return <ListTodo className="h-4 w-4" />;
	};

	const getTitle = () => {
		if (proposal.proposal_type === "idea_update") return `Update: ${proposal.current_title}`;
		if (proposal.proposal_type === "idea_creation") return `New Idea: ${proposal.title}`;
		return `New Task for: ${proposal.idea_title}`;
	};

	if (status === "accepted") {
		return (
			<div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
				<Check className="h-4 w-4" />
				Changes applied successfully
			</div>
		);
	}

	if (status === "rejected") {
		return (
			<div className="flex items-center gap-2 rounded-lg border bg-muted p-3 text-sm text-muted-foreground">
				<X className="h-4 w-4" />
				Change rejected - nothing modified
			</div>
		);
	}

	return (
		<Card className="my-2 border-2 border-primary/20">
			<CardHeader className="px-4 pb-2 pt-3">
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2">
						{getIcon()}
						<CardTitle className="text-sm font-semibold">{getTitle()}</CardTitle>
					</div>
					<Badge variant="outline" className="text-xs">
						Pending Review
					</Badge>
				</div>
			</CardHeader>

			<CardContent className="px-4 pb-3">
				{proposal.proposal_type === "idea_update" ? (
					<>
						<DiffView label="Title" oldValue={proposal.current_title} newValue={proposal.new_title} />

						<DiffView
							label="Description"
							oldValue={proposal.current_description}
							newValue={proposal.new_description}
						/>

						{proposal.new_status ? (
							<DiffView label="Status" oldValue={null} newValue={proposal.new_status} />
						) : null}

						{proposal.new_priority ? (
							<DiffView label="Priority" oldValue={null} newValue={proposal.new_priority} />
						) : null}
					</>
				) : null}

				{proposal.proposal_type === "idea_creation" ? (
					<div className="mb-3 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
						<p className="text-sm font-medium text-green-800 dark:text-green-200">{proposal.title}</p>
						<p className="mt-1 whitespace-pre-wrap break-words text-xs text-green-700 dark:text-green-300">
							{proposal.description}
						</p>

						{(proposal.proposed_status || proposal.proposed_priority) && (
							<div className="mt-2 flex flex-wrap gap-2">
								{proposal.proposed_status ? (
									<Badge variant="outline" className="text-[10px] uppercase">
										Status: {proposal.proposed_status}
									</Badge>
								) : null}
								{proposal.proposed_priority ? (
									<Badge variant="outline" className="text-[10px] uppercase">
										Priority: {proposal.proposed_priority}
									</Badge>
								) : null}
							</div>
						)}
					</div>
				) : null}

				{proposal.proposal_type === "task_creation" ? (
					<div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
						<p className="text-sm font-medium text-blue-800 dark:text-blue-200">{proposal.task_title}</p>
						{proposal.task_description ? (
							<p className="mt-1 whitespace-pre-wrap break-words text-xs text-blue-700 dark:text-blue-300">
								{proposal.task_description}
							</p>
						) : null}
					</div>
				) : null}

				<p className="mb-3 text-xs italic text-muted-foreground">Why: {proposal.reasoning}</p>

				<div className="flex gap-2">
					<Button
						size="sm"
						onClick={handleAccept}
						disabled={status === "accepting"}
						className="flex-1 bg-green-600 text-white hover:bg-green-700"
					>
						<Check className="mr-1 h-3 w-3" />
						{status === "accepting" ? "Applying..." : "Accept"}
					</Button>

					<Button
						size="sm"
						variant="outline"
						onClick={handleReject}
						disabled={status === "accepting"}
						className="flex-1 border-red-200 text-red-600 hover:bg-red-50"
					>
						<X className="mr-1 h-3 w-3" />
						Reject
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
