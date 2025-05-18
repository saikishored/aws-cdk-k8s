import { CfnOutput, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  BlockDevice,
  BlockDeviceVolume,
  EbsDeviceVolumeType,
  IKeyPair,
  Instance,
  InstanceClass,
  InstanceSize,
  InstanceType,
  IVpc,
  KeyPair,
  MachineImage,
  SecurityGroup,
  UserData,
  Vpc,
  SubnetType,
  Peer,
  Port,
} from "aws-cdk-lib/aws-ec2";
import {
  ManagedPolicy,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { readFileSync } from "fs";
import { join } from "path";

const k8sUserData = readFileSync(
  join(__dirname, "..", "k8s-scripts", "boot", "install.sh"),
  "utf8"
).split("\n");

const controlPlaneUserData = readFileSync(
  join(__dirname, "..", "k8s-scripts", "boot", "init.sh"),
  "utf8"
).split("\n");

export class K8sStack extends Stack {
  ec2KeyPair: IKeyPair;
  ctrlPlaneInstance: Instance;
  workerInstances: Instance[] = [];
  ctrlPlaneInstanceSg: SecurityGroup;
  workerSecurityGroup: SecurityGroup;
  vpc: IVpc;
  ec2Role: Role;
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    this.vpc = this.getVpc();
    this.ctrlPlaneInstanceSg = this.createSecurityGroup(
      "ctrl-plane-sg",
      "SG for K8 Control Plane"
    );
    this.workerSecurityGroup = this.createSecurityGroup(
      "worker-node-sg",
      "SG for Worker Node"
    );
    this.setInboundRules();
    this.ec2Role = this.createEc2Role("ec2-role");
    this.ec2KeyPair = KeyPair.fromKeyPairName(
      this,
      "key-pair",
      "ec2-instances"
    );
    const workerInstances = [
      "k8s-worker-1",
      // "k8s-worker-2"
    ];
    workerInstances.forEach((worker, index) => {
      this.workerInstances.push(
        this.createInstance(
          worker,
          InstanceSize.LARGE,
          true,
          this.workerSecurityGroup,
          k8sUserData
        )
      );
    });
    const joinWorkersUserData = this.workerInstances.map(
      (workerInstance) =>
        `aws ssm send-command --instance-ids "${workerInstance.instanceId}" --document-name "AWS-RunShellScript" --comment "Join worker to cluster" --parameters "commands=[\\"$(kubeadm token create --print-join-command)\\"]"`
    );
    this.ctrlPlaneInstance = this.createInstance(
      "k8s-ctrl-plane-lt",
      InstanceSize.XLARGE,
      true,
      this.ctrlPlaneInstanceSg,
      [...k8sUserData, ...controlPlaneUserData, ...joinWorkersUserData]
    );
    this.ctrlPlaneInstance.node.addDependency(this.workerInstances[0]);
    this.ctrlPlaneInstance.node.addDependency(this.workerInstances[1]);
    this.setOutput();
  }

  getVpc(): IVpc {
    return Vpc.fromLookup(this, "vpc", {
      isDefault: false,
      vpcId: "vpc-052216022ab8b9270",
    });
  }

  createSecurityGroup(id: string, description?: string): SecurityGroup {
    const sg = new SecurityGroup(this, id, {
      vpc: this.vpc,
      description,
      securityGroupName: id,
    });
    return sg;
  }

  createEc2Role(roleName: string): Role {
    return new Role(this, roleName, {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
      description: "Role for EC2 instance",
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2FullAccess"),
      ],
      inlinePolicies: {
        SsmPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              sid: "SendCommand",
              actions: ["ssm:SendCommand"],
              resources: ["*"],
            }),
          ],
        }),
      },
      roleName,
    });
  }

  setInboundRules() {
    this.ctrlPlaneInstanceSg.addIngressRule(
      Peer.anyIpv4(),
      Port.SSH,
      "allow from local to connect"
    );
    const portsToOpenForWorkerNodesInCtrlPlane = [
      "6443",
      "2379:2380",
      "10250",
      "10259",
      "10257",
    ];
    const portsToOpenForCtrlPlaneInWorkerNodes = [
      "10250",
      "10256",
      "30000:32767",
    ];
    portsToOpenForWorkerNodesInCtrlPlane.forEach((port) => {
      const portSplit = port.split(":").map((portValue) => parseInt(portValue));
      this.ctrlPlaneInstanceSg.addIngressRule(
        this.workerSecurityGroup,
        portSplit.length == 1
          ? Port.tcp(portSplit[0])
          : Port.tcpRange(portSplit[0], portSplit[1])
      );
    });
    portsToOpenForCtrlPlaneInWorkerNodes.forEach((port) => {
      const portSplit = port.split(":").map((portValue) => parseInt(portValue));
      const connection =
        portSplit.length == 1
          ? Port.tcp(portSplit[0])
          : Port.tcpRange(portSplit[0], portSplit[1]);

      this.workerSecurityGroup.addIngressRule(
        this.ctrlPlaneInstanceSg,
        connection
      );
      this.workerSecurityGroup.addIngressRule(
        this.workerSecurityGroup,
        connection
      );
    });
  }

  createInstance(
    instanceName: string,
    instanceSize: InstanceSize,
    secondaryBlockDevice: boolean,
    sg: SecurityGroup,
    userDataInput: string[] = ["echo 'No Userdata Supplied'"]
  ): Instance {
    const blockDevices: BlockDevice[] = [
      {
        deviceName: "/dev/xvda",
        volume: BlockDeviceVolume.ebs(20, {
          deleteOnTermination: true,
          volumeType: EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3,
        }),
      },
    ];
    const userData = UserData.forLinux();
    userData.addCommands(...userDataInput);
    return new Instance(this, instanceName, {
      associatePublicIpAddress: true,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      instanceType: InstanceType.of(InstanceClass.T4G, instanceSize),
      keyPair: this.ec2KeyPair,
      machineImage: MachineImage.fromSsmParameter("/ami/ubuntu"),
      blockDevices: secondaryBlockDevice ? blockDevices : undefined,
      requireImdsv2: true,
      vpc: this.vpc,
      securityGroup: sg,
      role: this.ec2Role,
      userData,
    });
  }

  setOutput() {
    new CfnOutput(this, "output-ctrl", {
      key: "CtrlPlaneInstanceId",
      value: this.ctrlPlaneInstance.instanceId,
    });
    this.workerInstances.forEach((instance, index) => {
      new CfnOutput(this, `output-w${index + 1}`, {
        key: `Worker${index + 1}InstanceId`,
        value: instance.instanceId,
      });
    });
  }
}
