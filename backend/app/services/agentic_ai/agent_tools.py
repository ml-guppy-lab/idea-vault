from typing import Any


# These tool definitions are sent to the LLM and define the exact contract
# for tool-calling in the agent loop.
# Think of this file as the agent's "menu of allowed actions".
# The model cannot call arbitrary Python functions - it can only call tools
# whose name, description, and JSON parameter schema are declared here.
AGENT_TOOLS: list[dict[str, Any]] = [
	{
		"type": "function",
		"function": {
			"name": "search_ideas",
			"description": (
				"Search the user's saved ideas by meaning or keyword. "
				"Use this to find a specific idea before proposing changes to it."
			),
			"parameters": {
				"type": "object",
				"properties": {
					"query": {
						"type": "string",
						"description": "The search query to find relevant ideas",
					}
				},
				"required": ["query"],
			},
		},
	},
	{
		"type": "function",
		"function": {
			"name": "propose_idea_update",
			"description": (
				"Propose updating an existing idea. Always search for the idea "
				"first to get its current content before proposing changes."
			),
			"parameters": {
				"type": "object",
				"properties": {
					"idea_id": {
						"type": "string",
						"description": "The MongoDB _id of the idea to update",
					},
					"current_title": {
						"type": "string",
						"description": "The CURRENT title of the idea (before changes)",
					},
					"new_title": {
						"type": "string",
						"description": "The proposed new title",
					},
					"current_description": {
						"type": "string",
						"description": "The CURRENT description (before changes)",
					},
					"new_description": {
						"type": "string",
						"description": "The proposed new description",
					},
					"current_summary": {
						"type": "string",
						"description": "The CURRENT summary of the idea (before changes)",
					},
					"new_summary": {
						"type": "string",
						"description": (
							"The proposed new summary. Only include if the title or "
							"description change genuinely alters the idea's meaning. "
							"Capture the updated concept in 2-3 sentences. Max 190 words."
						),
					},
					"new_status": {
						"type": "string",
						"enum": [
							"raw",
							"exploring",
							"validated",
							"building",
							"shipped",
							"abandoned",
						],
						"description": "Optional: proposed new status",
					},
					"new_priority": {
						"type": "string",
						"enum": ["low", "medium", "high"],
						"description": "Optional: proposed new priority",
					},
					"reasoning": {
						"type": "string",
						"description": (
							"Explain why you are proposing these specific changes"
						),
					},
				},
				"required": ["idea_id", "current_title", "new_title", "reasoning"],
			},
		},
	},
	{
		"type": "function",
		"function": {
			"name": "propose_idea_creation",
			"description": (
				"Propose creating a brand new idea. Use this when the user wants "
				"to add a new idea."
			),
			"parameters": {
				"type": "object",
				"properties": {
					"title": {
						"type": "string",
						"description": "The title for the new idea",
					},
					"description": {
						"type": "string",
						"description": "A detailed description for the new idea",
					},
					"status": {
						"type": "string",
						"enum": [
							"raw",
							"exploring",
							"validated",
							"building",
							"shipped",
							"abandoned",
						],
						"description": "Initial status for the idea",
					},
					"priority": {
						"type": "string",
						"enum": ["low", "medium", "high"],
						"description": "Initial priority for the idea",
					},
					"tags": {
						"type": "array",
						"items": {"type": "string"},
						"description": "Relevant tags for the idea",
					},
					"reasoning": {
						"type": "string",
						"description": "Why you are proposing this new idea",
					},
				},
				"required": ["title", "description", "reasoning"],
			},
		},
	},
	{
		"type": "function",
		"function": {
			"name": "propose_task_creation",
			"description": (
				"Propose adding a task under an existing idea to break it down "
				"into actionable steps."
			),
			"parameters": {
				"type": "object",
				"properties": {
					"idea_id": {
						"type": "string",
						"description": "The MongoDB _id of the idea to add the task to",
					},
					"idea_title": {
						"type": "string",
						"description": "The title of the parent idea (for display purposes)",
					},
					"task_title": {
						"type": "string",
						"description": "The title of the new task",
					},
					"task_description": {
						"type": "string",
						"description": "What needs to be done for this task",
					},
					"reasoning": {
						"type": "string",
						"description": "Why this task is important for the idea",
					},
				},
				"required": ["idea_id", "idea_title", "task_title", "reasoning"],
			},
		},
	},
]


# Tool names that execute immediately without user approval.
# These are safe because they only read data and never modify MongoDB.
READ_ONLY_TOOLS: frozenset[str] = frozenset({"search_ideas"})

# Tool names that require explicit user approval before any write execution.
# The agent may propose these actions, but the backend will not execute them
# until a separate /agent/decide call arrives with decision="accept".
PROPOSAL_TOOLS: frozenset[str] = frozenset(
	{"propose_idea_update", "propose_idea_creation", "propose_task_creation"}
)
