#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { EmployeeApiStack } from '../lib/employee-api-stack';

const app = new cdk.App();

new EmployeeApiStack(app, 'EmployeeApiStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});
