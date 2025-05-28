#!/usr/bin/env node
import { App, StackProps } from "aws-cdk-lib";
import { K8sStack } from "../lib/k8s-stack";
import { K8sClusterProps } from "../lib/types";
import { InstanceSize, SubnetType } from "aws-cdk-lib/aws-ec2";

const app = new App();
const clusterProps: K8sClusterProps = {
  vpcId: "vpc-052216022ab8b9270",
  amiParamName: "/ami/amazon-linux",
  keyPairName: "ec2-instances",
  associatePublicIpAddress: true,
  subnetType: SubnetType.PUBLIC,
  clusterName: "k8s",
  namePrefix: "learning",
  envTag: "dev",
  controlPlaneInstance: {
    size: InstanceSize.MEDIUM,
    ingressRules: [
      {
        port: {
          lowerRange: 6443,
          upperRange: 6443,
        },
        peerType: "AnyIpv4",
      },
    ],
  },
};

const stackProps: StackProps = {
  stackName: "k8s-stack",
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
