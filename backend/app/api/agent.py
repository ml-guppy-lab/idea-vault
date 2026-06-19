from fastapi import APIRouter, Depends, HTTPException

from app.core.security import get_current_user
from app.models.user import User
from app.schemas.agent import AgentResponse, ProposalDecision
from app.schemas.chat import ChatRequest
from app.services.agentic_ai.agent_service import execute_proposal, run_agent

router = APIRouter(prefix="/agent", tags=["agent"])


@router.post("", response_model=AgentResponse)
async def run_agent_endpoint(
	request: ChatRequest,
	current_user: User = Depends(get_current_user),
) -> AgentResponse:
	"""
	Run the agent for one user message.
	
	Returns assistant text plus pending proposals.
	No database write occurs in this endpoint.
	"""
	# Important: this endpoint is the "proposal generation" step only.
	# Even if the agent suggests edits, nothing is written to MongoDB here.
	result = await run_agent(
		user_message=request.message,
		user_id=str(current_user.id),
	)
	return result


@router.post("/decide")
async def decide_on_proposal(
	decision: ProposalDecision,
	current_user: User = Depends(get_current_user),
):
	"""
	Accept or reject one proposal.
	
	- reject: returns success without modifying data
	- accept: applies approved proposal using authenticated user scope
	"""
	# This second endpoint is the human-in-the-loop gate.
	# The first /agent call proposes; this /agent/decide call approves/rejects.
	user_id = str(current_user.id)

	if decision.decision == "reject":
		# Reject path is intentionally side-effect free.
		return {
			"success": True,
			"proposal_id": decision.proposal_id,
			"message": "Change rejected. Nothing was modified.",
		}

	if decision.decision == "accept":
		if decision.proposal is None:
			raise HTTPException(
				status_code=400,
				detail="proposal payload is required when decision is 'accept'",
			)
		# All actual writes are delegated to the service so route logic stays thin
		# and user scoping remains centralized in one execution layer.
		return await execute_proposal(decision.proposal, user_id)

	raise HTTPException(
		status_code=400,
		detail="Invalid decision. Must be 'accept' or 'reject'.",
	)
