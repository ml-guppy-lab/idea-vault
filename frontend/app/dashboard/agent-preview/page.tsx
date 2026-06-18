"use client";

import { ProposalCard, type Proposal } from "@/components/agent/ProposalCard";

const SAMPLE_PROPOSALS: Proposal[] = [
  {
    proposal_type: "idea_update",
    proposal_id: "sample-update-1",
    status: "pending",
    idea_id: "idea-1",
    current_title: "college idea",
    new_title: "The Ultimate College Wardrobe Guide",
    current_description: "",
    new_description:
      "A comprehensive guide for college fashion: capsule wardrobes, budget shopping, and outfit plans for different campus scenarios.",
    new_status: "exploring",
    new_priority: "medium",
    reasoning:
      "The original note is vague. This update gives a concrete title, structure, and execution direction.",
  },
  {
    proposal_type: "idea_creation",
    proposal_id: "sample-create-1",
    status: "pending",
    title: "AI Study Coach for STEM",
    description:
      "A guided planner that turns syllabus topics into weekly plans, tracks confidence, and suggests revision sessions.",
    proposed_status: "raw",
    proposed_priority: "high",
    tags: ["education", "ai"],
    reasoning: "This expands your education direction into a clear product concept.",
  },
  {
    proposal_type: "task_creation",
    proposal_id: "sample-task-1",
    status: "pending",
    idea_id: "idea-2",
    idea_title: "AI Study Coach for STEM",
    task_title: "Interview 5 students about pain points",
    task_description: "Collect top recurring study-planning frustrations from first-year students.",
    reasoning: "User interviews validate demand before building features.",
  },
];

export default function AgentPreviewPage() {
  const handleAccept = async () => {
    // Preview page only: mimic network latency so the loading state is visible.
    await new Promise((resolve) => setTimeout(resolve, 500));
  };

  const handleReject = () => {
    // Preview page only: card updates its own status after callback.
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Agent Proposal Card Preview</h1>
      <p className="text-sm text-muted-foreground">
        This page uses sample data so you can visually verify before/after diffs and action states.
      </p>

      {SAMPLE_PROPOSALS.map((proposal) => (
        <ProposalCard
          key={proposal.proposal_id}
          proposal={proposal}
          onAccept={handleAccept}
          onReject={handleReject}
        />
      ))}
    </div>
  );
}
