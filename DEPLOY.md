# Deploying PaperChat to AWS

One command deploys everything with AWS CDK: the static site on S3 + CloudFront, the Python API as a Docker image on Lambda, the S3 uploads bucket, the daily RAGAS eval Lambda, and CloudWatch alarms and a dashboard.

```
Browser ──► CloudFront ──► S3 (static Next.js site)
                └─ /api/* ──► Lambda function URL (IAM auth; only CloudFront can call it)
                               Python FastAPI container
                               ├─ Bedrock: GPT-5.6 Sol (agent) + Titan Text Embeddings V2
                               └─ Pinecone (one namespace per uploaded paper)
Browser ──► S3 uploads bucket (presigned POST; PDF deleted right after ingest)
EventBridge (daily) ──► Eval Lambda (RAGAS, Claude judge) ──► CloudWatch ──► alarms ──► email
```

Everything goes into **us-east-1** unless you set `CDK_DEFAULT_REGION`.

---

## Option A: deploy from GitHub, nothing to install (recommended for a new AWS account)

Everything happens in two browser tabs: the **AWS console** and your **GitHub repo**. GitHub Actions builds the Docker images on a free ARM runner and deploys with short-lived credentials (OpenID Connect), so no AWS access keys are created or stored.

**In the AWS console** (top-right region picker: **US East (N. Virginia) us-east-1**):

1. **Secure the account:** if you're signed in as the root user, turn on MFA (account menu → Security credentials).
2. **Turn on the Bedrock models:** see step 2 below.
3. **Store the Pinecone key:** Secrets Manager → **Store a new secret** → *Other type of secret* → **Plaintext** tab → delete the `{}` and paste **only** the key → Next → name it exactly `paperchat/pinecone-api-key` → Next → Next → Store.
   *(Optional access code: same steps, name `paperchat/access-code`, value = your code.)*
4. **Create the GitHub deploy role:** download [`infra/github-oidc-role.yaml`](./infra/github-oidc-role.yaml) → CloudFormation → **Create stack** → *With new resources* → **Upload a template file** → stack name `paperchat-github-deploy` → Next → Next → tick *"I acknowledge that AWS CloudFormation might create IAM resources with custom names"* → Submit. When it shows `CREATE_COMPLETE`, open the **Outputs** tab and copy **DeployRoleArn**.

**In GitHub** (`MerubS/PaperChat`):

5. Settings → Secrets and variables → Actions → **New repository secret**: name `AWS_DEPLOY_ROLE_ARN`, value = the ARN you copied. *(Optional: **Variables** tab → `ALERT_EMAIL` = your email, for alarms.)*
6. Make sure the AWS code is on the `production` branch (the role only trusts `production`; set the `Branch` parameter in step 4 to use another branch).
7. **Actions** tab → **Deploy to AWS** → **Run workflow** → choose branch **production** → **Run workflow**. It runs the tests, then deploys (about 15–20 minutes the first time). The run's **Summary** shows your `SiteUrl`.
8. If you set `ALERT_EMAIL`, confirm the AWS Notifications email.

**Run the evals once:** Lambda console → open the function named `PaperChat-EvalFunction…` → **Test** tab → create a test event (any name, keep `{}`) → **Test**. It takes a few minutes; scores appear on the **PaperChat** dashboard in CloudWatch.

To redeploy after changes, run the workflow again.

---

## Option B: deploy from your computer

## 1. Install the tools (once)

| Tool | Check | Get it |
|---|---|---|
| AWS CLI v2 | `aws --version` | https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html |
| Node.js 20+ | `node -v` | https://nodejs.org |
| Docker Desktop, **running** | `docker info` | https://www.docker.com/products/docker-desktop |

Then sign in to your AWS account from the terminal:

```bash
aws configure          # access key, secret, region us-east-1
# or, with IAM Identity Center:  aws configure sso
aws sts get-caller-identity   # should print your account ID
```

> The Lambda images are built for ARM (Graviton). On Apple Silicon that's native. On Intel/AMD machines Docker Desktop emulates it automatically, and the first build is just slower.

## 2. Turn on the Bedrock models (once)

In the AWS console, go to **Amazon Bedrock → Model catalog** (region **us-east-1**) and make sure you can use:

- **OpenAI GPT-5.6 Sol**: answers questions (the agent)
- **Amazon Titan Text Embeddings V2**: embeddings
- **Anthropic Claude Sonnet 5**: RAGAS judge for the daily evals

Open each model and request or enable access if asked. Anthropic models ask for a short use-case form the first time. Sending one message to each in the **Playground** is the quickest way to confirm access.

## 3. Store your Pinecone API key (once)

Create a free key at https://app.pinecone.io, then:

```bash
aws secretsmanager create-secret --region us-east-1 \
  --name paperchat/pinecone-api-key \
  --secret-string "YOUR_PINECONE_API_KEY"
```

You don't need to create a Pinecone index: the API creates `paperchat-bedrock` (1024 dimensions, cosine) on first use.

**Optional:** require an access code to use the demo:

```bash
aws secretsmanager create-secret --region us-east-1 \
  --name paperchat/access-code --secret-string "pick-a-code"
```

## 4. Build the site and deploy

From the repo root:

```bash
npm install --legacy-peer-deps
npm run build                 # static site -> out/

cd infra
npm install
npx cdk bootstrap             # once per AWS account/region
npx cdk deploy -c alertEmail=you@example.com
```

`cdk deploy` shows the IAM changes and asks you to confirm. The first deploy takes about 10–15 minutes, mostly building the two Docker images. When it finishes it prints:

```
PaperChat.SiteUrl          = https://dxxxxxxxx.cloudfront.net
PaperChat.EvalFunctionName = PaperChat-EvalFunction...
PaperChat.DashboardUrl     = https://us-east-1.console.aws.amazon.com/cloudwatch/...
```

Then:

1. **Confirm the email** from AWS Notifications so alarms reach you.
2. **Open `SiteUrl`** and upload a paper. The first request after a while is a Lambda cold start and takes a few extra seconds.

## 5. Run the evals once now

They run daily at 09:17 UTC, but you can run them right away to get your first scores:

```bash
aws lambda invoke --region us-east-1 \
  --function-name <EvalFunctionName from the output> \
  --cli-read-timeout 900 eval.json && cat eval.json
```

This takes a few minutes (20 questions × 4 RAGAS metrics). The scores show up on the **PaperChat** CloudWatch dashboard (`DashboardUrl`), and an alarm emails you if any score drops below 0.85 or the eval run fails.

## Updating

After code changes, rebuild and redeploy (only what changed is updated):

```bash
npm run build && cd infra && npx cdk deploy
```

## Settings

Pass with `-c key=value` on `cdk deploy`, or edit `infra/cdk.json`:

| Context key | Default | |
|---|---|---|
| `chatModelId` | `us.openai.gpt-5.6-sol` | Any Bedrock Converse model with tool use, e.g. `us.openai.gpt-5.6-terra` (cheaper) or `us.anthropic.claude-sonnet-5` |
| `evalJudgeModelId` | `us.anthropic.claude-sonnet-5` | RAGAS judge (kept on a different model family than the answers) |
| `embedModelId` | `amazon.titan-embed-text-v2:0` | Changing it needs a new Pinecone index |
| `pineconeIndexName` | `paperchat-bedrock` | |
| `alertEmail` | *(none)* | Where alarms are sent |

API limits (upload size, pages, rate limits, cleanup TTL) are environment variables on the API Lambda. See `backend/app/config.py`.

## Costs

At demo traffic this is small, but not zero:

- **Lambda, CloudFront, S3:** within the free tier for a demo.
- **Secrets Manager:** about $0.40 per secret per month.
- **CloudWatch:** 7 alarms at about $0.10 each per month; one dashboard (the first 3 are free).
- **Bedrock:** pay per token for answers, embeddings, and the **daily eval**, which is the largest recurring cost. To run evals less often, change the schedule in `infra/lib/paperchat-stack.ts` (e.g. weekly).
- **Pinecone:** the free Starter plan is enough.

Set an **AWS Budget** with an email alert (Billing → Budgets) so there are no surprises.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `cdk deploy` fails building images | Make sure Docker Desktop is running (`docker info`). |
| `AccessDeniedException` / "You don't have access to the model" in logs | Step 2: enable that model in us-east-1. |
| `ValidationException` about the model ID | The ID changed or isn't in your region; redeploy with `-c chatModelId=...` (Bedrock → Model catalog shows the IDs). |
| "Secret paperchat/pinecone-api-key not found" | Step 3, in the same region as the stack. |
| Upload says "Upload to storage failed" | The presigned URL expired (5 minutes); upload again. |

Logs: **CloudWatch → Log groups → `PaperChat-ApiLogs…`** (and `EvalLogs`), or `aws logs tail <log group> --follow`.

## Removing everything

```bash
cd infra && npx cdk destroy
aws secretsmanager delete-secret --region us-east-1 --name paperchat/pinecone-api-key --force-delete-without-recovery
aws secretsmanager delete-secret --region us-east-1 --name paperchat/access-code --force-delete-without-recovery
```

Delete the `paperchat-bedrock` index in the Pinecone console if you're done with it.
