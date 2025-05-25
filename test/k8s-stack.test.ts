import { App, StackProps } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { K8sStack } from "../lib/k8s-stack";
import { K8sClusterProps } from "../lib/types";
import { IPeer, IVpc } from "aws-cdk-lib/aws-ec2";
import { Role } from "aws-cdk-lib/aws-iam";

describe("K8sStack", () => {
  const clusterProps: K8sClusterProps = {
    vpcId: "vpc-052216022ab8b9270",
    amiParamName: "/ami/amazon-linux",
    keyPairName: "ec2-instances",
    associatePublicIpAddress: true,
    clusterName: "k8s",
    namePrefix: "learning",
    envTag: "dev",
  };
  const stackProps: StackProps = {
    stackName: "k8s-stack",
    env: {
      account: "123456789012",
      region: "ap-south-2",
    },
    tags: {
      dept: "platform",
      "cost-centre": "12345",
    },
  };
  jest.mock("aws-cdk-lib/aws-ec2", () => {
    return {
      Vpc: {
        Peer: jest.fn().mockImplementation(() => ({
          anyIpv4: jest.fn().mockReturnValue("peer" as unknown as IPeer),
        })),
        fromLookup: jest.fn().mockReturnValue({
          vpcId: "vpc-052216022ab8b9270",
        } as IVpc),
      },
      SecurityGroup: jest.fn().mockImplementation(() => ({
        fromSecurityGroupId: jest.fn().mockReturnValue({
          securityGroupId: "sg-1234567890abcdef0",
        }),
        addIngressRule: jest.fn(),
      })),
    };
  });
  const app = new App();
  const stack = new K8sStack(app, "TestK8sStack", clusterProps, stackProps);
  test("EC2 role to be instance of Role", () => {
    expect(stack.ec2Role).toBeInstanceOf(Role);
  });
  const template = Template.fromStack(stack);

  test("creates 2 EC2 instances", () => {
    template.resourceCountIs("AWS::EC2::Instance", 2);
  });

  test("2 Security Groups are created", () => {
    template.resourceCountIs("AWS::EC2::SecurityGroup", 2);
  });

  test("IAM Role is created with EC2 service principal", () => {
    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: {
              Service: "ec2.amazonaws.com",
            },
          }),
        ]),
      },
    });
  });

  test("Two Instance Profiles are created", () => {
    template.resourceCountIs("AWS::IAM::InstanceProfile", 2);
  });

  test("Two LaunchTemplates are created", () => {
    template.resourceCountIs("AWS::EC2::LaunchTemplate", 2);
  });
});
