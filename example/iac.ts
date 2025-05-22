#!/usr/bin/env node
import { App, StackProps } from "aws-cdk-lib";
import { K8sStack } from "../lib/k8s-stack";
import { K8sClusterProps } from "../lib/types";

const app = new App();
const clusterProps: K8sClusterProps = {
  vpcId: "vpc-052216022ab8b9270",
};

const stackProps: StackProps = {
  stackName: "k8-stack",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ap-south-2",
  },
  tags: {
    dept: "platform",
    "cost-centre": "12345",
  },
};

new K8sStack(app, "k8s-stack", clusterProps, stackProps);
