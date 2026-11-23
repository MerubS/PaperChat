#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PaperChatStack } from '../lib/paperchat-stack';

const app = new cdk.App();
new PaperChatStack(app, 'PaperChat', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    // us-east-1 by default: Bedrock's US inference profiles and the Pinecone index live there
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'PaperChat: agentic RAG over research papers (Lambda, Bedrock, S3, CloudFront)',
});
