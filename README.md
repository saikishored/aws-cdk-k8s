# Accelerator - Self Hosted Kubernetes cluster in AWS

## Objectives

This is under development with the following objectives

✅ Deploy Enterprise grade Production cluster on Day 1

✅ Higly Scalable

✅ Higly Available

✅ CI/CD Compatibilty

✅ Zero / Minimal Maintenance

## Milestones

| Version       | Expected Month | Release Date | Release Type     | Feature                                                 | Use Cases          |
| ------------- | -------------- | ------------ | ---------------- | ------------------------------------------------------- | ------------------ |
| v0.5.x        | May 2026       |              | Preview          | Single Controle Plane with multiple worker nodes        | `Education` `POC`  |
| v0.6.x        | Jul 2026       |              | Preview          | Auto Scaling                                            | `POC`              |
| v0.7.x        | Aug 2026       |              | Preview          | CI/CD Compatibility                                     | `POC`              |
| v1.0.0-beta.x | Sep 2026       |              | Preview          | Multiple Control Plane nodes with multiple worker nodes | `POC`              |
| v1.0.0        | Jan 2027       |              | Production Grade |                                                         | `POC` `Production` |

## Prerequisities

In order to use this accelerator, following are needed.

1. AWS Account with VPC (default or custom)
2. Log into AWS locally
3. Node.JS installed in your system
4. AWS CDk installed `npm i -g aws-cdk`
5. CDK Bootstrapped region. Refer to this [page](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html) on how to bootstrap your account/region
6. Basic knowledge of CDK and Typescript is recommended

## Steps / Commands to Deploy Cluster

1. Create a folder locally `mkdir my-project`
2. `cd my-project`
3. `cdk init --language typescript`
4. `npm i aws-k8s`
5. Open file `./bin/my-project.ts`
6. Replace the pre-populated code with the following code

```
import { App, StackProps } from "aws-cdk-lib";
import { K8sStack } from "../lib/k8s-stack";
import { K8sClusterProps } from "../lib/types";
import { InstanceSize } from "aws-cdk-lib/aws-ec2";

const app = new App();
const clusterProps: K8sClusterProps = {
  vpcId: "vpc-11111111111111111", // replace with your vpc id
  amiParamName: "/ami/amazon-linux",// See section 'Important Considerations'
  associatePublicIpAddress: true,// See section 'Important Considerations'

  // All the following attributes are optional
  subnetType: SubnetType.PUBLIC,// See section 'Important Considerations'
  keyPairName: "ec2-instances",
  Considerations'
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
    region: "<my-region>",
  },
  tags: {
    dept: "platform",
    "cost-centre": "12345",
  },
};

new K8sStack(app, "k8s-stack", clusterProps, stackProps);


```

7. Log into AWS locally
8. Set AWS profile with the following commands. Powershell: `$env:AWS_PROFILE='my-profile'`; Bash: `export AWS_PROFILE=my-profile`
9. Run command `cdk deploy`
10. Wait for the deployment to finish
11. Once deployment done, note down Control Plane instance ID from the output
12. Wait for 5-10 minutes after deployment is finished as the current version is not CI/CD compatible. This will allow EC2 instances to complete predefined userdata that installs Kubernetes and join the worker nodes to cluster
13. Log into Control Plane node by running the following command
    `aws ssm start-session --target $args[0] --region <my-region> --document-name AWS-StartInteractiveCommand --parameters command="/bin/bash"`
    Replace `<my-region>` with actual AWS Region
14. Above command will log you into Cluster instance
15. Run this command `sudo -i`
16. Run this command `kubectl get nodes` to see the nodes running. You should see an output like the following:

## Important Considerations

1. Attribute `amiParamName`:
   1. You should supply your own AMI ID that will be used for EC2 instance. AMI shoule be based on Red Hat based distribution. This is tested with Amazon Linux AMI. Hence, I recommend to use the same.
   2. Create a parameter in AWS with data type as `aws:ec2:image` and provide the ami id as the value. ex:`ami-050b6e407a84b6284`
   3. I have used Amazon Linux image `ami-050b6e407a84b6284` from region `ap-south-2` for testing of this library. You may use a value depending on your region
2. Attribute `associatePublicIpAddress`:
   You may set it to `true` only for education / training purpose. Otherwise, it is highly recommnded to set it to `false`. When this is `false`, ensure the following for proper connectivity

   1. Create following 3 VPC Endpoints
      SSM com.amazonaws.<region>.ssm
      EC2 Messages com.amazonaws.<region>.ec2messages
      SSM Messages com.amazonaws.<region>.ssmmessages
   2. Security group attached to VPC shoud have inbound rule to allow port `443` with source CIDR same as VPC CIDR. ex: `10.0.0.0/16`. This will allow Session Manager to register with EC2 SSM agent and you will be able to connect to EC2

3. Attribute `subnetType` :
   This is an optional attribute and defaults to Public. You may select other values, but ensure EC2 has necessary internet connection to install all required dependencies

4. Help document for other attributes: As this is a typescript project, there is a help documentation embedded for each attribute. Feel free to hover the mouse on an attribute, which will pop up the documentation. You should use IDE tool that supports intellisense ex: VS Code
