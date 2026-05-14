# run from backend directory
# command: python -m testFiles.test_embedding

from app.services.embedding_service import generate_idea_embedding
result = generate_idea_embedding(
    title="Fitness tracking app",
    description="Track daily workouts and calories",
    tags=["health", "mobile", "fitness"]
)
print(f"Type: {type(result)}")
print(f"Length: {len(result)}")
print(f"First 3 values: {result[:3]}")