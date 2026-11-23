import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ecrAssets from 'aws-cdk-lib/aws-ecr-assets';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';

const REPO_ROOT = path.join(__dirname, '..', '..');
const SCORE_THRESHOLD = 0.85;

/**
 * PaperChat on AWS:
 *
 *   Browser ──► CloudFront ──► S3 (static Next.js site)
 *                   └─ /api/* ──► Lambda function URL (IAM auth, signed by CloudFront OAC)
 *                                  Python FastAPI container: Bedrock (GPT-5.6 + Titan) + Pinecone
 *   Browser ──► S3 uploads bucket (presigned POST; object deleted right after ingest)
 *   EventBridge (daily) ──► eval Lambda (RAGAS) ──► CloudWatch metrics ──► alarms ──► SNS email
 */
export class PaperChatStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const ctx = (key: string, fallback = '') => (this.node.tryGetContext(key) as string) || fallback;
    const chatModelId = ctx('chatModelId', 'us.openai.gpt-5.6-sol');
    const evalJudgeModelId = ctx('evalJudgeModelId', 'us.anthropic.claude-sonnet-5');
    const embedModelId = ctx('embedModelId', 'amazon.titan-embed-text-v2:0');
    const pineconeIndexName = ctx('pineconeIndexName', 'paperchat-bedrock');
    const alertEmail = ctx('alertEmail');

    // ---------- Storage ----------

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      // Ingest deletes each PDF right away; this catches any upload that was never ingested.
      lifecycleRules: [{ prefix: 'uploads/', expiration: cdk.Duration.days(1) }],
      // The browser POSTs the file straight to S3. CORS isn't the access control here: every
      // upload needs a presigned policy from the API (5-minute expiry, one key, size and type
      // limits). Any origin is allowed so the bucket doesn't depend on the CloudFront domain.
      cors: [{ allowedMethods: [s3.HttpMethods.POST], allowedOrigins: ['*'], allowedHeaders: ['*'], maxAge: 3000 }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ---------- Lambda functions (one Dockerfile, two targets) ----------

    const commonEnv = {
      CHAT_MODEL_ID: chatModelId,
      EVAL_JUDGE_MODEL_ID: evalJudgeModelId,
      EMBED_MODEL_ID: embedModelId,
      PINECONE_INDEX_NAME: pineconeIndexName,
      PINECONE_SECRET_NAME: 'paperchat/pinecone-api-key',
      ACCESS_CODE_SECRET_NAME: 'paperchat/access-code',
      UPLOAD_BUCKET: uploadsBucket.bucketName,
    };

    const image = (target: string) =>
      lambda.DockerImageCode.fromImageAsset(REPO_ROOT, {
        file: 'backend/Dockerfile',
        target,
        platform: ecrAssets.Platform.LINUX_ARM64,
      });

    const apiFn = new lambda.DockerImageFunction(this, 'ApiFunction', {
      code: image('api'),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(90),
      environment: commonEnv,
      logGroup: new logs.LogGroup(this, 'ApiLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.DESTROY }),
      description: 'PaperChat API (FastAPI): uploads, agentic RAG answers, cleanup',
    });

    const evalFn = new lambda.DockerImageFunction(this, 'EvalFunction', {
      code: image('evals'),
      architecture: lambda.Architecture.ARM_64,
      memorySize: 2048,
      timeout: cdk.Duration.minutes(15),
      environment: commonEnv,
      logGroup: new logs.LogGroup(this, 'EvalLogs', { retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.DESTROY }),
      description: 'PaperChat daily RAGAS evaluation -> CloudWatch metrics',
    });

    // ---------- Permissions (least privilege) ----------

    for (const fn of [apiFn, evalFn]) {
      fn.addToRolePolicy(new iam.PolicyStatement({
        sid: 'InvokeBedrockModels',
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/*',
          `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        ],
      }));
      fn.addToRolePolicy(new iam.PolicyStatement({
        sid: 'ReadPaperChatSecrets',
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:paperchat/*`],
      }));
    }
    // Presigned POSTs are signed with the API role, so it needs PutObject; it reads and deletes on ingest.
    uploadsBucket.grantPut(apiFn, 'uploads/*');
    uploadsBucket.grantRead(apiFn, 'uploads/*');
    uploadsBucket.grantDelete(apiFn, 'uploads/*');
    evalFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
      conditions: { StringEquals: { 'cloudwatch:namespace': 'PaperChat/Evals' } },
    }));

    // ---------- CloudFront ----------

    // IAM-auth function URL: only CloudFront (signing with OAC) can call the API.
    const apiUrl = apiFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'PaperChat',
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: origins.FunctionUrlOrigin.withOriginAccessControl(apiUrl, { readTimeout: cdk.Duration.seconds(90) }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Forwards viewer headers plus CloudFront-Viewer-Address (unspoofable client IP for rate limits)
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        },
      },
      // A private S3 origin returns 403 for missing files; show the 404 page for both
      errorResponses: [403, 404].map((httpStatus) => ({ httpStatus, responseHttpStatus: 404, responsePagePath: '/404.html' })),
    });


    new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [s3deploy.Source.asset(path.join(REPO_ROOT, 'out'))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // ---------- Daily evals ----------

    new events.Rule(this, 'DailyEval', {
      description: 'Run the PaperChat RAGAS evaluation daily',
      schedule: events.Schedule.cron({ minute: '17', hour: '9' }), // 09:17 UTC
      targets: [new targets.LambdaFunction(evalFn, { retryAttempts: 0 })],
    });

    // ---------- Monitoring ----------

    const topic = new sns.Topic(this, 'Alerts', { displayName: 'PaperChat alerts' });
    if (alertEmail) topic.addSubscription(new subs.EmailSubscription(alertEmail));
    const notify = new cwActions.SnsAction(topic);

    const evalMetric = (name: string) =>
      new cloudwatch.Metric({ namespace: 'PaperChat/Evals', metricName: name, period: cdk.Duration.days(1), statistic: 'Average' });
    const scoreNames = ['Faithfulness', 'AnswerRelevancy', 'ContextPrecision', 'ContextRecall'];

    for (const name of scoreNames) {
      new cloudwatch.Alarm(this, `${name}Alarm`, {
        alarmName: `PaperChat-${name}-below-${SCORE_THRESHOLD}`,
        alarmDescription: `RAGAS ${name} dropped below ${SCORE_THRESHOLD}: a RAG quality regression.`,
        metric: evalMetric(name),
        threshold: SCORE_THRESHOLD,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.MISSING,
      }).addAlarmAction(notify);
    }

    new cloudwatch.Alarm(this, 'EvalFailedAlarm', {
      alarmName: 'PaperChat-eval-run-failed',
      alarmDescription: 'The daily eval Lambda errored, so quality scores were not published.',
      metric: evalFn.metricErrors({ period: cdk.Duration.days(1) }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(notify);

    new cloudwatch.Alarm(this, 'ApiErrorsAlarm', {
      alarmName: 'PaperChat-api-errors',
      alarmDescription: 'The API Lambda is erroring.',
      metric: apiFn.metricErrors({ period: cdk.Duration.minutes(5) }),
      threshold: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(notify);

    const apiMetric = (name: string, statistic: string) =>
      new cloudwatch.Metric({
        namespace: 'PaperChat', metricName: name, dimensionsMap: { Service: 'api' },
        statistic, period: cdk.Duration.minutes(5),
      });

    new cloudwatch.Alarm(this, 'RetrievalLatencyAlarm', {
      alarmName: 'PaperChat-retrieval-p90-over-1s',
      alarmDescription: 'p90 retrieval latency (embed query + Pinecone search) is over 1 second.',
      metric: apiMetric('RetrievalLatencyMs', 'p90'),
      threshold: 1000,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 3,
      datapointsToAlarm: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(notify);

    const dashboard = new cloudwatch.Dashboard(this, 'Dashboard', { dashboardName: 'PaperChat' });
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'RAGAS scores (daily)', width: 12,
        left: scoreNames.map(evalMetric),
        leftYAxis: { min: 0, max: 1 },
        leftAnnotations: [{ value: SCORE_THRESHOLD, label: 'benchmark', color: '#d62728' }],
      }),
      new cloudwatch.GraphWidget({
        title: 'Retrieval latency (ms)', width: 12,
        left: [apiMetric('RetrievalLatencyMs', 'p50'), apiMetric('RetrievalLatencyMs', 'p90')],
        leftAnnotations: [{ value: 1000, label: '1 second', color: '#d62728' }],
      }),
      new cloudwatch.GraphWidget({
        title: 'Answer latency (ms)', width: 12,
        left: [apiMetric('AnswerLatencyMs', 'p50'), apiMetric('AnswerLatencyMs', 'p90')],
      }),
      new cloudwatch.GraphWidget({
        title: 'API invocations and errors', width: 12,
        left: [apiFn.metricInvocations(), apiFn.metricErrors()],
      }),
    );

    // ---------- Outputs ----------

    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'EvalFunctionName', { value: evalFn.functionName });
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=PaperChat`,
    });
  }
}
