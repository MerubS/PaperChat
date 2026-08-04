import json
import os
import sys
from datetime import datetime
from dotenv import load_dotenv
from pinecone import Pinecone
from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_pinecone import PineconeVectorStore
from ragas.run_config import RunConfig
from ragas import evaluate, EvaluationDataset, SingleTurnSample
from ragas.metrics import (
    Faithfulness,
    AnswerRelevancy,
    ContextPrecision,
    ContextRecall,
)

load_dotenv()

# --- Validate environment ---
required_vars = ["OPENAI_API_KEY", "PINECONE_API_KEY", "PINECONE_INDEX_NAME"]
for var in required_vars:
    if not os.getenv(var):
        print(f"❌ Missing environment variable: {var}")
        sys.exit(1)

print("✅ Environment variables loaded\n")

# --- Helper function ---
def extract_score(scores, key):
    """Safely extract score regardless of RAGAS version."""
    val = scores[key]

    # Already a number
    if isinstance(val, (int, float)):
        return float(val)

    # List of numbers - take mean
    if isinstance(val, list):
        valid = [
            v for v in val
            if v is not None and not (isinstance(v, float) and v != v)
        ]
        return sum(valid) / len(valid) if valid else 0.0

    # Pandas Series - take mean
    try:
        return float(val.mean())
    except Exception:
        return 0.0

# --- Setup ---
pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
index = pc.Index(os.getenv("PINECONE_INDEX_NAME"))

embeddings = OpenAIEmbeddings(
    openai_api_key=os.getenv("OPENAI_API_KEY"),
    model="text-embedding-ada-002"
)

answer_llm = ChatOpenAI(
    model="gpt-4",
    openai_api_key=os.getenv("OPENAI_API_KEY"),
    temperature=0
)

eval_llm = ChatOpenAI(
    model="gpt-3.5-turbo",
    openai_api_key=os.getenv("OPENAI_API_KEY"),
    temperature=0
)


# --- Load dataset ---
with open("evals/dataset.json") as f:
    dataset = json.load(f)

print(f"📋 Loaded {len(dataset)} evaluation questions\n")

# --- Group by paper ---
papers = {}
for item in dataset:
    paper = item["paper"]
    if paper not in papers:
        papers[paper] = []
    papers[paper].append(item)

print(f"📄 Papers to evaluate: {list(papers.keys())}\n")

# --- Run evals per paper ---
all_results = []
paper_scores = {}

for paper_name, questions in papers.items():
    print(f"\n{'='*60}")
    print(f"📄 Evaluating paper: {paper_name.upper()}")
    print(f"{'='*60}")

    doc_id = questions[0]["document_id"]

    if "REPLACE_WITH" in doc_id:
        print(f"⚠️  Skipping {paper_name} - document ID not set!")
        continue

    # Load vector store
    try:
        vector_store = PineconeVectorStore(
            index=index,
            embedding=embeddings,
            namespace=doc_id
        )
        print(f"✅ Connected to Pinecone namespace: {doc_id}\n")
    except Exception as e:
        print(f"❌ Failed to connect to Pinecone: {e}")
        continue

    # --- Build samples list INSIDE the paper loop ---
    samples = []
    results = []
    MAX_QUESTIONS_PER_PAPER = 10 

    for i, item in enumerate(questions[:MAX_QUESTIONS_PER_PAPER]):
        question = item["question"]
        ground_truth = item["ground_truth"]

        print(f"[{i+1}/{len(questions)}] Q: {question[:60]}...")

        try:
            # Retrieve relevant chunks
            retrieved_docs = vector_store.similarity_search(question, k=4)
            contexts = [doc.page_content for doc in retrieved_docs]

            if not contexts:
                print(f"  ⚠️  No relevant chunks found!")
                continue

            # Generate answer
            context_text = "\n\n---\n\n".join(contexts)
            messages = [
                {
                    "role": "system",
                    "content": f"""You are a precise research paper assistant.

CRITICAL RULES:
1. Answer the question DIRECTLY in your first sentence
2. ONLY use information explicitly stated in the context
3. Do NOT add information from outside the context
4. Do NOT make assumptions or inferences
5. If the answer is not in the context, say: "I could not find that specific information in the provided context."
6. Keep answers concise and focused on what was asked

ANSWER FORMAT RULES:
- "What X was used?" → Begin: "The study used [X]..."
- "How many?" → Begin with the number directly
- "What did X do?" → Begin with the action directly  
- "What were the findings?" → Begin with the finding directly
- "How was X computed?" → Begin: "X was computed by..."
- Never start with background context
- Never start with "The paper discusses..." or "This study..."

Context from the research paper:
{context_text}"""
                },
                {
                    "role": "user",
                    "content": question
                }
            ]

            response = answer_llm.invoke(messages)
            answer = response.content

            print(f"  ✅ Answer generated ({len(answer)} chars)")
            print(f"  📚 Retrieved {len(contexts)} chunks")

            # Add to samples
            samples.append(SingleTurnSample(
                user_input=question,
                response=answer,
                retrieved_contexts=contexts,
                reference=ground_truth
            ))

            results.append({
                "question": question,
                "answer": answer,
                "contexts": contexts,
                "ground_truth": ground_truth,
                "paper": paper_name
            })

        except Exception as e:
            print(f"  ❌ Error on question {i+1}: {e}")
            continue

    # --- Check if we have samples BEFORE running RAGAS ---
    if not samples:
        print(f"\n⚠️  No samples collected for {paper_name} - skipping RAGAS eval")
        continue

    print(f"\n✅ Collected {len(samples)} samples for {paper_name}")

    # --- Run RAGAS ---
    print(f"📊 Running RAGAS evaluation for {paper_name}...\n")

    try:
        eval_dataset = EvaluationDataset(samples=samples)

        scores = evaluate(
            dataset=eval_dataset,
            metrics=[
                Faithfulness(),
                AnswerRelevancy(),
                ContextPrecision(),
                ContextRecall(),
            ],
            llm=eval_llm,
            embeddings=embeddings,
            run_config=RunConfig(
                timeout=120,        # Wait up to 120 seconds per call
                max_retries=5,      # Retry 5 times on failure
                max_wait=60,        # Wait up to 60 seconds between retries
                max_workers=1       # Only 1 call at a time (no parallelism)
            )
        )

        # Extract scores safely
        faith = extract_score(scores, "faithfulness")
        relev = extract_score(scores, "answer_relevancy")
        prec  = extract_score(scores, "context_precision")
        rec   = extract_score(scores, "context_recall")

        paper_scores[paper_name] = {
            "faithfulness": faith,
            "answer_relevancy": relev,
            "context_precision": prec,
            "context_recall": rec,
            "num_questions": len(samples)
        }

        all_results.extend(results)

        print(f"\n{'='*40}")
        print(f"📊 Results for {paper_name.upper()}")
        print(f"{'='*40}")
        print(f"Faithfulness:      {faith:.3f}  (higher = less hallucination)")
        print(f"Answer Relevancy:  {relev:.3f}  (higher = more on-topic)")
        print(f"Context Precision: {prec:.3f}  (higher = better retrieval)")
        print(f"Context Recall:    {rec:.3f}  (higher = less missing info)")

    except Exception as e:
        print(f"❌ RAGAS evaluation failed: {e}")
        import traceback
        traceback.print_exc()
        continue

# --- Overall scores ---
if paper_scores:
    print(f"\n{'='*60}")
    print("📊 OVERALL EVAL RESULTS")
    print(f"{'='*60}")

    all_f = [s["faithfulness"] for s in paper_scores.values()]
    all_r = [s["answer_relevancy"] for s in paper_scores.values()]
    all_p = [s["context_precision"] for s in paper_scores.values()]
    all_c = [s["context_recall"] for s in paper_scores.values()]

    print(f"\n{'Paper':<20} {'Faithful':>10} {'Relevancy':>10} {'Precision':>10} {'Recall':>10}")
    print("-" * 62)

    for paper, s in paper_scores.items():
        print(
            f"{paper:<20} "
            f"{s['faithfulness']:>10.3f} "
            f"{s['answer_relevancy']:>10.3f} "
            f"{s['context_precision']:>10.3f} "
            f"{s['context_recall']:>10.3f}"
        )

    print("-" * 62)
    print(
        f"{'AVERAGE':<20} "
        f"{sum(all_f)/len(all_f):>10.3f} "
        f"{sum(all_r)/len(all_r):>10.3f} "
        f"{sum(all_p)/len(all_p):>10.3f} "
        f"{sum(all_c)/len(all_c):>10.3f}"
    )

    # Diagnosis
    avg_p = sum(all_p) / len(all_p)
    avg_c = sum(all_c) / len(all_c)
    avg_f = sum(all_f) / len(all_f)
    avg_r = sum(all_r) / len(all_r)

    print(f"\n🔍 DIAGNOSIS:")
    issues_found = False

    if avg_p < 0.7:
        print("⚠️  LOW Context Precision → Fix: Reduce chunk size in rag.ts")
        issues_found = True
    if avg_c < 0.7:
        print("⚠️  LOW Context Recall → Fix: Increase k from 3 to 5 in rag.ts")
        issues_found = True
    if avg_f < 0.8:
        print("⚠️  LOW Faithfulness → Fix: Tighten system prompt in rag.ts")
        issues_found = True
    if avg_r < 0.8:
        print("⚠️  LOW Answer Relevancy → Fix: Improve prompt template")
        issues_found = True
    if not issues_found:
        print("✅ All metrics look good! Your RAG system is performing well.")

    # Save results
    output = {
        "timestamp": datetime.now().isoformat(),
        "papers_evaluated": list(paper_scores.keys()),
        "per_paper_scores": paper_scores,
        "overall_scores": {
            "faithfulness": sum(all_f) / len(all_f),
            "answer_relevancy": sum(all_r) / len(all_r),
            "context_precision": sum(all_p) / len(all_p),
            "context_recall": sum(all_c) / len(all_c),
        },
        "individual_results": all_results
    }

    with open("evals/results.json", "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n✅ Results saved to evals/results.json")

else:
    print("\n❌ No papers were evaluated.")
    print("   Check: Are document IDs correct in dataset.json?")
    print("   Check: Are papers uploaded to Pinecone?")