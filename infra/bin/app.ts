#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PaperChatStack } from '../lib/paperchat-stack';

const app = new cdk.App();
new PaperChatStack(app, 'PaperChat', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    // us-east-2 by default (the region a Free-plan AWS account is limited to). Override with
    // CDK_DEFAULT_REGION, or the AWS_REGION repository variable when deploying from GitHub.
    region: process.env.CDK_DEFAULT_REGION || 'us-east-2',
  },
  description: 'PaperChat: agentic RAG over research papers (Lambda, Bedrock, S3, CloudFront)',
});
