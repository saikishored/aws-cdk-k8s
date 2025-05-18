#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { K8sStack } from "../lib/k8s-stack";

const app = new cdk.App();
new K8sStack(app, "k8s-stack", {
  stackName: "k8-stack",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ap-south-2",
  },
});
