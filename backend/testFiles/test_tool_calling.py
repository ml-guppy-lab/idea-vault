import asyncio
import json
import sys
import os
from pathlib import Path

# Load .env before imports
from dotenv import load_dotenv
backend_dir = Path(__file__).parent.parent
env_path = backend_dir / ".env"
load_dotenv(env_path)

sys.path.insert(0, str(backend_dir))
from openai import AsyncOpenAI
from app.core.llm_config import LLMConfig
# Define two simple tools
tools = [
    {
        "type": "function",
        "function": {
            "name": "propose_idea_update",
            "description": "Propose an update to an existing idea. Use this when the user wants to improve or modify an idea.",
            "parameters": {
                "type": "object",
                "properties": {
                    "idea_id": {
                        "type": "string",
                        "description": "The ID of the idea to update"
                    },
                    "new_title": {
                        "type": "string",
                        "description": "The improved title for the idea"
                    },
                    "new_description": {
                        "type": "string",
                        "description": "The improved description for the idea"
                    },
                    "reasoning": {
                        "type": "string",
                        "description": "Why you are making these changes"
                    }
                },
                "required": ["idea_id", "new_title", "new_description", "reasoning"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "propose_task_creation",
            "description": "Propose creating a new task under an idea. Use this when breaking down an idea into actionable steps.",
            "parameters": {
                "type": "object",
                "properties": {
                    "idea_id": {
                        "type": "string",
                        "description": "The ID of the idea to add the task to"
                    },
                    "task_title": {
                        "type": "string",
                        "description": "The title of the new task"
                    },
                    "task_description": {
                        "type": "string",
                        "description": "What needs to be done for this task"
                    }
                },
                "required": ["idea_id", "task_title", "task_description"]
            }
        }
    }
]
async def test():
    config = LLMConfig()
    client = AsyncOpenAI(
        base_url=config.base_url,
        api_key=config.api_key
    )
    # Simulate a user request
    messages = [
        {
            "role": "system",
            "content": "You are a helpful assistant. The user has an idea with ID 'abc123' called 'Healthify' — a basic fitness tracker app."
        },
        {
            "role": "user",
            "content": "Can you improve my Healthify idea and add 2 tasks to get started?"
                # "What is my Healthify idea about?" — should NOT call tools, should answer with text
                # "Improve my Healthify idea" — should call propose_idea_update
                # "Add 3 tasks to Healthify" — should call propose_task_creation three times
                # "Improve Healthify and add tasks" — should call both tools
        }
    ]
    print("Sending request to LLM with tools...")
    response = await client.chat.completions.create(
        model=config.model,
        messages=messages,
        tools=tools,
        tool_choice="auto"  # LLM decides whether to use tools or not
    )
    print(f"\nFinish reason: {response.choices[0].finish_reason}")
    print(f"\nResponse content: {response.choices[0].message.content}")
    print(f"\nTool calls made:")
    if response.choices[0].message.tool_calls:
        for tool_call in response.choices[0].message.tool_calls:
            print(f"\n  Tool: {tool_call.function.name}")
            args = json.loads(tool_call.function.arguments)
            print(f"  Arguments: {json.dumps(args, indent=4)}")
    else:
        print("  None — LLM responded with text instead of tool calls")
asyncio.run(test())