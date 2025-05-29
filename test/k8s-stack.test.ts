import { App, Stack, StackProps } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { K8sStack } from "../lib/k8s-stack";
import { K8sClusterProps } from "../lib/types";
import {
  EbsDeviceVolumeType,
  IPeer,
  IVpc,
  SubnetType,
} from "aws-cdk-lib/aws-ec2";
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
    controlPlaneInstance: {
      ingressRules: [
        {
          port: {
            lowerRange: 443,
          },
          peerType: "AnyIpv4",
        },
      ],
      secondaryVolumes: [
        {
          volumeSizeinGb: 20,
          volumeType: EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3,
          deviceName: "/dev/sdb",
        },
      ],
    },
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

  test("IAM Role is created with required managed policies", () => {
    template.hasResourceProperties(
      "AWS::IAM::Role",
      Match.objectLike({
        ManagedPolicyArns: Match.arrayWith([
          Match.objectLike({
            "Fn::Join": Match.arrayWith([
              "",
              Match.arrayWith([
                "arn:",
                { Ref: "AWS::Partition" },
                ":iam::aws:policy/AmazonSSMManagedInstanceCore",
              ]),
            ]),
          }),
          Match.objectLike({
            "Fn::Join": Match.arrayWith([
              "",
              Match.arrayWith([
                "arn:",
                { Ref: "AWS::Partition" },
                ":iam::aws:policy/AmazonEC2FullAccess",
              ]),
            ]),
          }),
        ]),
      })
    );
  });

  test("Two Instance Profiles are created", () => {
    template.resourceCountIs("AWS::IAM::InstanceProfile", 2);
  });

  test("Two LaunchTemplates are created", () => {
    template.resourceCountIs("AWS::EC2::LaunchTemplate", 2);
  });

  test("Providing both subnetIds and subnetType should throw an error", () => {
    try {
      new K8sStack(
        app,
        "TestK8sStackSubnetError",
        {
          ...clusterProps,
          subnets: [
            {
              subnetId: "subnet-xxxxx",
              availabilityZone: "ap-south-2a",
            },
          ],
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        },
        stackProps
      );
    } catch (error) {
      console.log(error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "Attributes subnetIds and subnetType are mutually exclusive. Please remove one of the attributes from K8sClusterProps"
      );
    }
  });

  test("Peer not provided in ingress rule when peerType is 'SecurityGroup' should throw an error", () => {
    try {
      new K8sStack(
        app,
        "TestK8sStackPeerError",
        {
          ...clusterProps,
          controlPlaneInstance: {
            ingressRules: [
              {
                port: {
                  lowerRange: 443,
                },
                peerType: "SecurityGroup",
              },
            ],
          },
        },
        stackProps
      );
    } catch (error) {
      console.log(error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "attribute 'peer'is mandatory for an ingress rule when 'peerType' is defined as 'SecurityGroup' for ControlPlane node"
      );
    }
  });
  test("EC2 role to be instance of IRole when roleArn is provided", () => {
    const roleArnStack = new K8sStack(
      app,
      "TestK8sStackWithRoleArn",
      {
        ...clusterProps,
        roleArn: "arn:aws:iam::123456789012:role/MyCustomRole",
      },
      stackProps
    );
    expect(roleArnStack.ec2Role.roleArn).toBe(
      "arn:aws:iam::123456789012:role/MyCustomRole"
    );
  });
  test("Should throw an error when reserved device name is used", () => {
    try {
      new K8sStack(
        app,
        "TestK8sStackDeviceNameError",
        {
          ...clusterProps,
          workerInstance: {
            secondaryVolumes: [
              {
                volumeSizeinGb: 20,
                volumeType: EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3,
                deviceName: "/dev/xvda", // Reserved device name
              },
            ],
          },
        },
        stackProps
      );
    } catch (error) {
      console.log(error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "devicename can not be same for primary and secondary volumes for instance k8s-worker-1"
      );
    }
  });
  test("Stack is constructed when subnets are provided", () => {
    const subnetsStack = new K8sStack(
      app,
      "TestK8sStackWithSubnets",
      {
        ...clusterProps,
        associatePublicIpAddress: false,
        subnets: [
          {
            subnetId: "subnet-123456",
            availabilityZone: "ap-south-2a",
          },
        ],
      },
      stackProps
    );
    expect(subnetsStack).toBeInstanceOf(Stack);
  });
});
